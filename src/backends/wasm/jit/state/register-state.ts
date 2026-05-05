import type { OperandWidth, RegisterAlias, Reg32 } from "#x86/isa/types.js";
import { stateOffset } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import {
  cleanValueWidth,
  emitCleanValueForFullUse,
  emitMaskValueToWidth,
  type WasmIrEmitValueOptions,
  type ValueWidth
} from "#backends/wasm/codegen/value-width.js";
import { emitLoadStateU16, emitLoadStateU32, emitLoadStateU8, emitStoreStateU32 } from "#backends/wasm/codegen/state.js";
import {
  aliasByteRange,
  byteCount,
  byteSourceAt,
  byteSourcesForAlias,
  byteWidth,
  clearPartialBytes,
  directFullLocalForRead,
  emptyRegValueState,
  fullRegAccess,
  fullWidth,
  recordPartialValue,
  type RegValueState
} from "./register-lanes.js";
import {
  emitByteSourceForStore8,
  emitComposedByteSources,
  emitExtractAliasFromLocal,
  emitMergedBytes,
  emitStoreAliasValueIntoFullLocal,
  emitStoreByteSourceIntoFullLocal,
  emitStoreStateU16,
  emitStoreStateU8,
  emitWordSourceForStore16
} from "./register-emit.js";
import { planRegisterExitStore, type RegisterStoreOp } from "./register-store-plan.js";

export type JitReg32InstructionOptions = Readonly<{
  preserveCommittedRegs: boolean;
}>;

export type JitReg32State = Readonly<{
  beginInstruction(options: JitReg32InstructionOptions): void;
  commitPending(): void;
  commitPendingReg(reg: Reg32): void;
  emitReadReg32(reg: Reg32): ValueWidth;
  emitReadAlias(alias: RegisterAlias, options?: WasmIrEmitValueOptions): ValueWidth;
  emitWriteAlias(alias: RegisterAlias, emitValue: () => ValueWidth | void): void;
  emitWriteAliasIf(
    alias: RegisterAlias,
    emitCondition: () => ValueWidth | void,
    emitValue: () => ValueWidth | void
  ): void;
  emitCommittedStore(reg: Reg32): void;
}>;

export function createJitReg32State(body: WasmFunctionBodyEncoder): JitReg32State {
  const committedStates = new Map<Reg32, RegValueState>();
  const pendingStates = new Map<Reg32, RegValueState>();
  let preserveCommittedRegs = false;

  return {
    beginInstruction: (options) => {
      assertNoPending();
      preserveCommittedRegs = options.preserveCommittedRegs;
    },
    emitReadReg32: (reg) => emitReadAlias(fullRegAccess(reg)),
    emitReadAlias,
    emitWriteAlias,
    emitWriteAliasIf,
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

      const storePlan = planRegisterExitStore(state);

      if (storePlan.kind === "partial") {
        emitPartialStateStores(reg, storePlan.stores);
        return;
      }

      emitStoreStateU32(body, stateOffset[reg], () => {
        emitFullValue(reg, state);
      });
    }
  };

  function emitReadAlias(alias: RegisterAlias, options: WasmIrEmitValueOptions = {}): ValueWidth {
    const pending = pendingStates.get(alias.base);
    const committed = committedStates.get(alias.base);
    const directFullLocal = directFullLocalForRead(alias, pending, committed);

    if (directFullLocal !== undefined) {
      return emitExtractAliasFromLocal(body, directFullLocal, alias, options);
    }

    const byteSources = byteSourcesForAlias(alias, pending, committed);

    if (byteSources !== undefined) {
      emitComposedByteSources(body, byteSources);
      return cleanValueWidth(alias.width);
    }

    if (canLoadAliasFromState(alias, pending, committed)) {
      emitLoadAliasFromState(alias);
      return cleanValueWidth(alias.width);
    }

    const target = pending ?? committedStateForReg(alias.base);
    const fullLocal = materializeFull(alias.base, target, pending === undefined ? undefined : committed);

    return emitExtractAliasFromLocal(body, fullLocal, alias, options);
  }

  function emitWriteAlias(alias: RegisterAlias, emitValue: () => ValueWidth | void): void {
    const state = writableStateForReg(alias.base);

    if (alias.width === fullWidth) {
      emitCleanValueForFullUse(body, emitValue() ?? undefined);
      const local = fullLocalForWrite(state);

      body.localSet(local);
      state.fullLocal = local;
      clearPartialBytes(state);
      return;
    }

    const valueLocal = localForMaskedValue(alias.width, emitValue);

    if (state.fullLocal !== undefined) {
      emitStoreAliasValueIntoFullLocal(body, state.fullLocal, alias, valueLocal);
      return;
    }

    recordPartialValue(state, alias, valueLocal);
  }

  function emitWriteAliasIf(
    alias: RegisterAlias,
    emitCondition: () => ValueWidth | void,
    emitValue: () => ValueWidth | void
  ): void {
    const state = writableStateForReg(alias.base);
    const committed = preserveCommittedRegs ? committedStates.get(alias.base) : undefined;
    const fullLocal = materializeFull(alias.base, state, committed);

    emitCleanValueForFullUse(body, emitCondition() ?? undefined);
    body.ifBlock();

    if (alias.width === fullWidth) {
      emitCleanValueForFullUse(body, emitValue() ?? undefined);
      body.localSet(fullLocal);
    } else {
      const valueLocal = localForMaskedValue(alias.width, emitValue);

      emitStoreAliasValueIntoFullLocal(body, fullLocal, alias, valueLocal);
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
        emitMergedBytes(body, base);
      }
    }

    emitMergedBytes(body, state);
  }

  function canLoadAliasFromState(
    alias: RegisterAlias,
    pending: RegValueState | undefined,
    committed: RegValueState | undefined
  ): boolean {
    if (alias.width === fullWidth) {
      return false;
    }

    const { startByte, byteLength } = aliasByteRange(alias);

    for (let index = 0; index < byteLength; index += 1) {
      if (byteSourceAt(startByte + index, pending, committed) !== undefined) {
        return false;
      }
    }

    return true;
  }

  function emitLoadAliasFromState(alias: RegisterAlias): void {
    const offset = stateOffset[alias.base] + alias.bitOffset / byteWidth;

    switch (alias.width) {
      case 8:
        emitLoadStateU8(body, offset);
        return;
      case 16:
        emitLoadStateU16(body, offset);
        return;
      case 32:
        throw new Error("full-width aliases must use full state loads");
    }
  }

  function emitPartialStateStores(reg: Reg32, stores: readonly RegisterStoreOp[]): void {
    const baseOffset = stateOffset[reg];

    for (const store of stores) {
      if (store.kind === "store16") {
        emitStoreStateU16(body, baseOffset + store.byteIndex, () => {
          emitWordSourceForStore16(body, store.sources);
        });
        continue;
      }

      emitStoreStateU8(body, baseOffset + store.byteIndex, () => {
        emitByteSourceForStore8(body, store.source);
      });
    }
  }

  function localForMaskedValue(width: OperandWidth, emitValue: () => ValueWidth | void): number {
    const local = body.addLocal(wasmValueType.i32);

    emitMaskValueToWidth(body, width, emitValue() ?? undefined);
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
          emitStoreByteSourceIntoFullLocal(body, target.fullLocal, byteIndex, byte);
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
