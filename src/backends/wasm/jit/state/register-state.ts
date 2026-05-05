import type { OperandWidth, RegisterAlias, Reg32 } from "#x86/isa/types.js";
import { stateOffset } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import {
  cleanValueWidth,
  emitCleanValueForFullUse,
  emitMaskValueToWidth,
  emitSignExtendValueToWidth,
  type WasmIrEmitValueOptions,
  type ValueWidth
} from "#backends/wasm/codegen/value-width.js";
import {
  emitLoadStateS16,
  emitLoadStateS8,
  emitLoadStateU16,
  emitLoadStateU32,
  emitLoadStateU8,
  emitStoreStateU32
} from "#backends/wasm/codegen/state.js";
import {
  aliasByteRange,
  byteCount,
  byteSourceAt,
  byteSourcesForAlias,
  byteWidth,
  clearPartialBytes,
  emptyRegValueState,
  existingLocalForRegisterValue,
  fullRegAccess,
  fullWidth,
  rebindableLocalForAlias,
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

export type JitReg32WriteSource = (() => ValueWidth | void) | Readonly<{
  emitValue: () => ValueWidth | void;
  rebindLocal?: number;
}>;

export type JitReg32State = Readonly<{
  beginInstruction(options: JitReg32InstructionOptions): void;
  commitPending(): void;
  commitPendingReg(reg: Reg32): void;
  emitReadReg32(reg: Reg32): ValueWidth;
  emitReadAlias(alias: RegisterAlias, options?: WasmIrEmitValueOptions): ValueWidth;
  rebindableLocalForAlias(alias: RegisterAlias): number | undefined;
  emitWriteAlias(alias: RegisterAlias, source: JitReg32WriteSource): void;
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
  let committedLocalIdentitiesPinned = false;

  return {
    beginInstruction: (options) => {
      assertNoPending();
      preserveCommittedRegs = options.preserveCommittedRegs;
    },
    emitReadReg32: (reg) => emitReadAlias(fullRegAccess(reg)),
    emitReadAlias,
    rebindableLocalForAlias: rebindableLocalForAliasInState,
    emitWriteAlias,
    emitWriteAliasIf,
    commitPending: () => {
      for (const reg of [...pendingStates.keys()]) {
        commitPendingReg(reg);
      }

      if (preserveCommittedRegs) {
        committedLocalIdentitiesPinned = true;
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
    const existingLocal = existingLocalForRegisterValue(pending, committed);

    if (existingLocal !== undefined) {
      return emitExtractAliasFromLocal(body, existingLocal, alias, options);
    }

    const byteSources = byteSourcesForAlias(alias, pending, committed);

    if (byteSources !== undefined) {
      emitComposedByteSources(body, byteSources);
      return options.signed === true && alias.width < fullWidth
        ? emitSignExtendValueToWidth(body, alias.width as 8 | 16)
        : cleanValueWidth(alias.width);
    }

    if (canLoadAliasFromState(alias, pending, committed)) {
      return emitLoadAliasFromState(alias, options);
    }

    const target = pending ?? committedStateForReg(alias.base);
    const fullLocal = materializeFull(alias.base, target, pending === undefined ? undefined : committed);

    return emitExtractAliasFromLocal(body, fullLocal, alias, options);
  }

  function rebindableLocalForAliasInState(alias: RegisterAlias): number | undefined {
    return rebindableLocalForAlias(
      alias,
      pendingStates.get(alias.base),
      committedStates.get(alias.base)
    );
  }

  function emitWriteAlias(alias: RegisterAlias, source: JitReg32WriteSource): void {
    const writeSource = normalizeWriteSource(source);
    const state = writableStateForReg(alias.base);

    if (alias.width === fullWidth) {
      // A rebind changes only register-state ownership. It intentionally emits
      // no local.get/local.set pair when the source value already has a local.
      if (writeSource.rebindLocal !== undefined && canRebindLocal(state)) {
        rebindToLocal(state, writeSource.rebindLocal);
        return;
      }

      emitCleanValueForFullUse(body, writeSource.emitValue() ?? undefined);
      const local = localForRegisterOverwrite(state);

      body.localSet(local);
      state.fullLocal = local;
      clearPartialBytes(state);
      return;
    }

    const valueLocal = localForMaskedValue(alias.width, writeSource.emitValue);

    if (state.fullLocal !== undefined) {
      emitStoreAliasValueIntoFullLocal(body, ensureWritableRegisterLocal(alias.base, state), alias, valueLocal);
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
    const local = ensureWritableRegisterLocal(alias.base, state, committed);

    emitCleanValueForFullUse(body, emitCondition() ?? undefined);
    body.ifBlock();

    if (alias.width === fullWidth) {
      emitCleanValueForFullUse(body, emitValue() ?? undefined);
      body.localSet(local);
    } else {
      const valueLocal = localForMaskedValue(alias.width, emitValue);

      emitStoreAliasValueIntoFullLocal(body, local, alias, valueLocal);
    }

    body.endBlock();
  }

  function commitPendingReg(reg: Reg32): void {
    const pending = pendingStates.get(reg);

    if (pending === undefined) {
      return;
    }

    mergeStateInto(reg, committedStateForReg(reg), pending);
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

  function emitLoadAliasFromState(alias: RegisterAlias, options: WasmIrEmitValueOptions): ValueWidth {
    const offset = stateOffset[alias.base] + alias.bitOffset / byteWidth;

    switch (alias.width) {
      case 8:
        if (options.signed === true) {
          emitLoadStateS8(body, offset);
          return cleanValueWidth(fullWidth);
        }
        emitLoadStateU8(body, offset);
        return cleanValueWidth(8);
      case 16:
        if (options.signed === true) {
          emitLoadStateS16(body, offset);
          return cleanValueWidth(fullWidth);
        }
        emitLoadStateU16(body, offset);
        return cleanValueWidth(16);
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

  function localForRegisterOverwrite(state: RegValueState): number {
    if (state.fullLocal !== undefined && !fullLocalIsShared(state, state.fullLocal)) {
      return state.fullLocal;
    }

    const local = body.addLocal(wasmValueType.i32);

    state.fullLocal = local;
    clearPartialBytes(state);
    return local;
  }

  function ensureWritableRegisterLocal(reg: Reg32, state: RegValueState, base?: RegValueState): number {
    if (state.fullLocal !== undefined && !fullLocalIsShared(state, state.fullLocal)) {
      return state.fullLocal;
    }

    // Rebinding can make multiple architectural registers share one Wasm local.
    // Any later in-place update must first detach so the other register keeps
    // seeing the old value.
    const local = body.addLocal(wasmValueType.i32);

    emitFullValue(reg, state, base);
    body.localSet(local);
    state.fullLocal = local;
    clearPartialBytes(state);
    return local;
  }

  function rebindToLocal(state: RegValueState, local: number): void {
    state.fullLocal = local;
    clearPartialBytes(state);
  }

  function canRebindLocal(state: RegValueState): boolean {
    // After pre-instruction exits are emitted, earlier exit blocks may still
    // store committed locals. Keep committed local identities stable from then
    // on; pending states remain safe to rebind.
    return preserveCommittedRegs || state.fullLocal === undefined || !committedLocalIdentitiesPinned;
  }

  function mergeStateInto(reg: Reg32, target: RegValueState, source: RegValueState): void {
    if (source.fullLocal !== undefined) {
      target.fullLocal = source.fullLocal;
      clearPartialBytes(target);
      return;
    }

    if (target.fullLocal !== undefined) {
      const targetLocal = ensureWritableRegisterLocal(reg, target);

      for (let byteIndex = 0; byteIndex < byteCount; byteIndex += 1) {
        const byte = source.bytes[byteIndex];

        if (byte !== undefined) {
          emitStoreByteSourceIntoFullLocal(body, targetLocal, byteIndex, byte);
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

  function fullLocalIsShared(owner: RegValueState, local: number): boolean {
    return stateMaps().some((states) =>
      [...states.values()].some((state) => state !== owner && state.fullLocal === local)
    );
  }

  function stateMaps(): readonly Map<Reg32, RegValueState>[] {
    return [committedStates, pendingStates];
  }
}

function normalizeWriteSource(source: JitReg32WriteSource): Readonly<{
  emitValue: () => ValueWidth | void;
  rebindLocal?: number;
}> {
  return typeof source === "function" ? { emitValue: source } : source;
}

function stateForReg(states: Map<Reg32, RegValueState>, reg: Reg32): RegValueState {
  let state = states.get(reg);

  if (state === undefined) {
    state = emptyRegValueState();
    states.set(reg, state);
  }

  return state;
}
