import type { OperandWidth, RegisterAlias, Reg32 } from "#x86/isa/types.js";
import { i32, widthMask } from "#x86/state/cpu-state.js";
import { stateOffset, wasmMemoryIndex } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import type { WasmIrReg32Storage } from "#backends/wasm/codegen/registers.js";
import { emitMaskValueToWidth } from "#backends/wasm/codegen/registers.js";
import { emitLoadStateU32, emitStoreStateU32 } from "#backends/wasm/codegen/state.js";

export type JitReg32InstructionOptions = Readonly<{
  preserveCommittedRegs: boolean;
}>;

export type JitReg32State = WasmIrReg32Storage & Readonly<{
  beginInstruction(options: JitReg32InstructionOptions): void;
  commitPending(): void;
  commitPendingReg(reg: Reg32): void;
  emitGetAlias(alias: RegisterAlias): void;
  emitSetAlias(alias: RegisterAlias, emitValue: () => void): void;
  emitSetAliasIf(alias: RegisterAlias, emitCondition: () => void, emitValue: () => void): void;
  emitSetIf(reg: Reg32, emitCondition: () => void, emitValue: () => void): void;
  emitCommittedStore(reg: Reg32): void;
}>;

type ByteSource = Readonly<{
  local: number;
  bitOffset: number;
}>;

type RegValueState = {
  fullLocal?: number;
  bytes: (ByteSource | undefined)[];
};

const fullWidth = 32;
const byteWidth = 8;
const byteMask = 0xff;
const byteCount = 4;

export function createJitReg32State(body: WasmFunctionBodyEncoder): JitReg32State {
  const committedStates = new Map<Reg32, RegValueState>();
  const pendingStates = new Map<Reg32, RegValueState>();
  let preserveCommittedRegs = false;

  return {
    beginInstruction: (options) => {
      assertNoPending();
      preserveCommittedRegs = options.preserveCommittedRegs;
    },
    emitGet: (reg) => {
      emitGetAlias(fullRegAccess(reg));
    },
    emitSet: (reg, emitValue) => {
      emitSetAlias(fullRegAccess(reg), emitValue);
    },
    emitGetAlias,
    emitSetAlias,
    emitSetIf: (reg, emitCondition, emitValue) => {
      emitSetAliasIf(fullRegAccess(reg), emitCondition, emitValue);
    },
    emitSetAliasIf,
    commitPending: () => {
      for (const reg of [...pendingStates.keys()]) {
        commitPendingReg(reg);
      }

      preserveCommittedRegs = false;
    },
    commitPendingReg: (reg) => {
      commitPendingReg(reg);
    },
    emitCommittedStore: (reg) => {
      const state = committedStates.get(reg);

      if (state === undefined) {
        throw new Error(`dirty JIT register has no committed state: ${reg}`);
      }

      if (state.fullLocal === undefined && hasPartialBytes(state)) {
        emitPartialStateStores(reg, state);
        return;
      }

      emitStoreStateU32(body, stateOffset[reg], () => {
        emitFullValue(reg, state);
      });
    }
  };

  function emitGetAlias(alias: RegisterAlias): void {
    const pending = pendingStates.get(alias.base);
    const committed = committedStates.get(alias.base);
    const directFullLocal = directFullLocalForRead(alias, pending, committed);

    if (directFullLocal !== undefined) {
      emitExtractAliasFromLocal(directFullLocal, alias);
      return;
    }

    const byteSources = byteSourcesForAlias(alias, pending, committed);

    if (byteSources !== undefined) {
      emitComposedByteSources(byteSources);
      return;
    }

    const target = pending ?? committedStateForReg(alias.base);
    const fullLocal = materializeFull(alias.base, target, pending === undefined ? undefined : committed);

    emitExtractAliasFromLocal(fullLocal, alias);
  }

  function emitSetAlias(alias: RegisterAlias, emitValue: () => void): void {
    const state = writableStateForReg(alias.base);

    if (alias.width === fullWidth) {
      emitValue();
      const local = fullLocalForWrite(state);

      body.localSet(local);
      state.fullLocal = local;
      clearPartialBytes(state);
      return;
    }

    const valueLocal = localForMaskedValue(alias.width, emitValue);

    if (state.fullLocal !== undefined) {
      emitStoreAliasValueIntoFullLocal(state.fullLocal, alias, valueLocal);
      return;
    }

    recordPartialValue(state, alias, valueLocal);
  }

  function emitSetAliasIf(alias: RegisterAlias, emitCondition: () => void, emitValue: () => void): void {
    const state = writableStateForReg(alias.base);
    const committed = preserveCommittedRegs ? committedStates.get(alias.base) : undefined;
    const fullLocal = materializeFull(alias.base, state, committed);

    emitCondition();
    body.ifBlock();

    if (alias.width === fullWidth) {
      emitValue();
      body.localSet(fullLocal);
    } else {
      const valueLocal = localForMaskedValue(alias.width, emitValue);

      emitStoreAliasValueIntoFullLocal(fullLocal, alias, valueLocal);
    }

    body.endBlock();
  }

  function commitPendingReg(reg: Reg32): void {
    const pending = pendingStates.get(reg);

    if (pending === undefined) {
      return;
    }

    mergeStateInto(committedStateForReg(reg), pending);
    pendingStates.delete(reg);
  }

  function writableStateForReg(reg: Reg32): RegValueState {
    return preserveCommittedRegs
      ? stateForReg(pendingStates, reg)
      : committedStateForReg(reg);
  }

  function committedStateForReg(reg: Reg32): RegValueState {
    return stateForReg(committedStates, reg);
  }

  function materializeFull(reg: Reg32, target: RegValueState, base?: RegValueState): number {
    if (target.fullLocal !== undefined) {
      return target.fullLocal;
    }

    const local = body.addLocal(wasmValueType.i32);

    emitFullValue(reg, target, base);
    body.localSet(local);
    target.fullLocal = local;
    clearPartialBytes(target);
    return local;
  }

  function emitFullValue(reg: Reg32, state: RegValueState, base?: RegValueState): void {
    if (state.fullLocal !== undefined) {
      body.localGet(state.fullLocal);
      return;
    }

    if (base?.fullLocal !== undefined) {
      body.localGet(base.fullLocal);
    } else {
      emitLoadStateU32(body, stateOffset[reg]);
      if (base !== undefined) {
        emitMergedBytes(base);
      }
    }

    emitMergedBytes(state);
  }

  function emitMergedBytes(state: RegValueState): void {
    if (state.fullLocal !== undefined) {
      return;
    }

    for (let byteIndex = 0; byteIndex < byteCount; byteIndex += 1) {
      const source = state.bytes[byteIndex];

      if (source === undefined) {
        continue;
      }

      const shift = byteIndex * byteWidth;
      const shiftedMask = byteMask << shift;

      body.i32Const(i32(~shiftedMask)).i32And();
      emitByteSource(source);

      if (shift !== 0) {
        body.i32Const(shift).i32Shl();
      }

      body.i32Or();
    }
  }

  function emitPartialStateStores(reg: Reg32, state: RegValueState): void {
    const baseOffset = stateOffset[reg];
    let byteIndex = 0;

    while (byteIndex < byteCount) {
      const source = state.bytes[byteIndex];

      if (source === undefined) {
        byteIndex += 1;
        continue;
      }

      const nextSource = state.bytes[byteIndex + 1];

      if (nextSource !== undefined) {
        emitStoreStateU16(baseOffset + byteIndex, () => {
          emitComposedByteSources([source, nextSource]);
        });
        byteIndex += 2;
        continue;
      }

      emitStoreStateU8(baseOffset + byteIndex, () => {
        emitByteSource(source);
      });
      byteIndex += 1;
    }
  }

  function emitStoreStateU8(offset: number, emitValue: () => void): void {
    body.i32Const(0);
    emitValue();
    body.i32Store8({
      align: 0,
      memoryIndex: wasmMemoryIndex.state,
      offset
    });
  }

  function emitStoreStateU16(offset: number, emitValue: () => void): void {
    body.i32Const(0);
    emitValue();
    body.i32Store16({
      align: offset % 2 === 0 ? 1 : 0,
      memoryIndex: wasmMemoryIndex.state,
      offset
    });
  }

  function emitStoreAliasValueIntoFullLocal(fullLocal: number, alias: RegisterAlias, valueLocal: number): void {
    const shiftedMask = aliasMask(alias);

    body.localGet(fullLocal).i32Const(i32(~shiftedMask)).i32And();
    body.localGet(valueLocal);

    if (alias.bitOffset !== 0) {
      body.i32Const(alias.bitOffset).i32Shl();
    }

    body.i32Or().localSet(fullLocal);
  }

  function recordPartialValue(state: RegValueState, alias: RegisterAlias, valueLocal: number): void {
    const startByte = alias.bitOffset / byteWidth;
    const bytes = alias.width / byteWidth;

    for (let index = 0; index < bytes; index += 1) {
      state.bytes[startByte + index] = {
        local: valueLocal,
        bitOffset: index * byteWidth
      };
    }
  }

  function localForMaskedValue(width: OperandWidth, emitValue: () => void): number {
    const local = body.addLocal(wasmValueType.i32);

    emitValue();
    emitMaskValueToWidth(body, width);
    body.localSet(local);
    return local;
  }

  function fullLocalForWrite(state: RegValueState): number {
    if (state.fullLocal !== undefined) {
      return state.fullLocal;
    }

    const local = body.addLocal(wasmValueType.i32);

    state.fullLocal = local;
    clearPartialBytes(state);
    return local;
  }

  function mergeStateInto(target: RegValueState, source: RegValueState): void {
    if (source.fullLocal !== undefined) {
      target.fullLocal = source.fullLocal;
      clearPartialBytes(target);
      return;
    }

    if (target.fullLocal !== undefined) {
      for (let byteIndex = 0; byteIndex < byteCount; byteIndex += 1) {
        const byte = source.bytes[byteIndex];

        if (byte !== undefined) {
          emitStoreByteSourceIntoFullLocal(target.fullLocal, byteIndex, byte);
        }
      }
      return;
    }

    for (let byteIndex = 0; byteIndex < byteCount; byteIndex += 1) {
      const byte = source.bytes[byteIndex];

      if (byte !== undefined) {
        target.bytes[byteIndex] = byte;
      }
    }
  }

  function emitStoreByteSourceIntoFullLocal(fullLocal: number, byteIndex: number, source: ByteSource): void {
    const shift = byteIndex * byteWidth;
    const shiftedMask = byteMask << shift;

    body.localGet(fullLocal).i32Const(i32(~shiftedMask)).i32And();
    emitByteSource(source);

    if (shift !== 0) {
      body.i32Const(shift).i32Shl();
    }

    body.i32Or().localSet(fullLocal);
  }

  function emitExtractAliasFromLocal(local: number, alias: RegisterAlias): void {
    body.localGet(local);

    if (alias.bitOffset !== 0) {
      body.i32Const(alias.bitOffset).i32ShrU();
    }

    emitMaskValueToWidth(body, alias.width);
  }

  function emitComposedByteSources(sources: readonly ByteSource[]): void {
    for (let index = 0; index < sources.length; index += 1) {
      emitByteSource(sources[index]!);

      const shift = index * byteWidth;

      if (shift !== 0) {
        body.i32Const(shift).i32Shl();
      }

      if (index !== 0) {
        body.i32Or();
      }
    }
  }

  function emitByteSource(source: ByteSource): void {
    body.localGet(source.local);

    if (source.bitOffset !== 0) {
      body.i32Const(source.bitOffset).i32ShrU();
    }

    body.i32Const(byteMask).i32And();
  }

  function directFullLocalForRead(
    alias: RegisterAlias,
    pending: RegValueState | undefined,
    committed: RegValueState | undefined
  ): number | undefined {
    if (pending?.fullLocal !== undefined) {
      return pending.fullLocal;
    }

    if (pending !== undefined && hasPartialBytes(pending)) {
      return undefined;
    }

    return committed?.fullLocal;
  }

  function byteSourcesForAlias(
    alias: RegisterAlias,
    pending: RegValueState | undefined,
    committed: RegValueState | undefined
  ): readonly ByteSource[] | undefined {
    const startByte = alias.bitOffset / byteWidth;
    const bytes = alias.width / byteWidth;
    const sources: ByteSource[] = [];

    for (let index = 0; index < bytes; index += 1) {
      const source = byteSourceAt(startByte + index, pending, committed);

      if (source === undefined) {
        return undefined;
      }

      sources.push(source);
    }

    return sources;
  }

  function byteSourceAt(
    byteIndex: number,
    pending: RegValueState | undefined,
    committed: RegValueState | undefined
  ): ByteSource | undefined {
    if (pending?.fullLocal !== undefined) {
      return { local: pending.fullLocal, bitOffset: byteIndex * byteWidth };
    }

    const pendingByte = pending?.bytes[byteIndex];

    if (pendingByte !== undefined) {
      return pendingByte;
    }

    if (committed?.fullLocal !== undefined) {
      return { local: committed.fullLocal, bitOffset: byteIndex * byteWidth };
    }

    return committed?.bytes[byteIndex];
  }

  function assertNoPending(): void {
    if (pendingStates.size !== 0) {
      throw new Error("JIT register pending writes were not committed");
    }
  }
}

function stateForReg(states: Map<Reg32, RegValueState>, reg: Reg32): RegValueState {
  let state = states.get(reg);

  if (state === undefined) {
    state = emptyRegValueState();
    states.set(reg, state);
  }

  return state;
}

function emptyRegValueState(): RegValueState {
  return {
    bytes: new Array<ByteSource | undefined>(byteCount).fill(undefined)
  };
}

function clearPartialBytes(state: RegValueState): void {
  state.bytes.fill(undefined);
}

function hasPartialBytes(state: RegValueState): boolean {
  return state.bytes.some((source) => source !== undefined);
}

function fullRegAccess(reg: Reg32): RegisterAlias {
  return { name: reg, base: reg, bitOffset: 0, width: fullWidth };
}

function aliasMask(alias: RegisterAlias): number {
  return (widthMask(alias.width) << alias.bitOffset) >>> 0;
}
