import type { OperandWidth, RegisterAlias, Reg32 } from "#x86/isa/types.js";
import { stateOffset } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import {
  cleanValueWidth,
  dirtyValueWidth,
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
  byteWidth,
  emptyRegValueState,
  exactFullLocalSource,
  exactLocalSourceForAlias,
  fullRegAccess,
  fullWidth,
  localMergeBaseForKnownBytes,
  localSourceAt,
  localSourcesForAlias,
  localValueForAlias,
  mergePartialLocalValues,
  recordFullLocalValue,
  recordPartialLocalValue,
  stateUsesLocal,
  type LocalLaneSource,
  type RegValueState
} from "./register-lanes.js";
import {
  emitComposedLocalLaneSources,
  emitExtractAliasFromLocal,
  emitLocalLaneSourceForStore8,
  emitMergedBytes,
  emitStoreAliasValueIntoFullLocal,
  emitStoreStateU16,
  emitStoreStateU8,
  emitWordLocalLaneSourceForStore16
} from "./register-emit.js";
import { planRegisterExitStore, type RegisterStoreOp } from "./register-store-plan.js";

export type JitReg32InstructionOptions = Readonly<{
  preserveCommittedRegs: boolean;
}>;

export type JitReg32WriteSource = (() => ValueWidth | void) | Readonly<{
  emitValue: () => ValueWidth | void;
  sourceLocal?: number;
}>;

export type JitReg32State = Readonly<{
  beginInstruction(options: JitReg32InstructionOptions): void;
  commitPending(): void;
  commitPendingReg(reg: Reg32): void;
  emitReadReg32(reg: Reg32): ValueWidth;
  emitReadAlias(alias: RegisterAlias, options?: WasmIrEmitValueOptions): ValueWidth;
  localValueForAlias(alias: RegisterAlias): number | undefined;
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
    localValueForAlias: localValueForAliasInState,
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
    const exactSource = exactLocalSourceForAlias(alias, pending, committed);

    if (exactSource !== undefined) {
      return emitExactSourceForAlias(exactSource, alias, options);
    }

    const localSources = localSourcesForAlias(alias, pending, committed);

    if (localSources !== undefined) {
      emitComposedLocalLaneSources(body, localSources);
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

  function localValueForAliasInState(alias: RegisterAlias): number | undefined {
    return localValueForAlias(
      alias,
      pendingStates.get(alias.base),
      committedStates.get(alias.base)
    );
  }

  function emitWriteAlias(alias: RegisterAlias, source: JitReg32WriteSource): void {
    const writeSource = normalizeWriteSource(source);
    const state = writableStateForReg(alias.base);

    if (alias.width === fullWidth) {
      // Copying an existing local-backed value updates architectural lane state
      // without claiming the source local as this register's mutable cell.
      if (writeSource.sourceLocal !== undefined && canCopyLocalValue(state)) {
        recordFullLocalValue(state, writeSource.sourceLocal);
        return;
      }

      emitCleanValueForFullUse(body, writeSource.emitValue() ?? undefined);
      const local = localForRegisterOverwrite(state);

      body.localSet(local);
      recordFullLocalValue(state, local, { mutable: true });
      return;
    }

    const valueLocal = localForMaskedValue(alias.width, writeSource.emitValue);

    recordPartialLocalValue(state, alias, valueLocal);
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
    recordFullLocalValue(state, local, { mutable: true });
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
    const fullSource = exactFullLocalSource(target);

    if (fullSource !== undefined) {
      return fullSource.local;
    }

    const local = body.addLocal(wasmValueType.i32);

    emitFullValue(reg, target, base);
    body.localSet(local);
    recordFullLocalValue(target, local, { mutable: true });
    return local;
  }

  function emitFullValue(reg: Reg32, state: RegValueState, base?: RegValueState): void {
    const fullSource = exactFullLocalSource(state);

    if (fullSource !== undefined) {
      body.localGet(fullSource.local);
      return;
    }

    const baseFullSource = exactFullLocalSource(base);

    if (baseFullSource !== undefined) {
      body.localGet(baseFullSource.local);
      emitMergedBytes(body, state);
      return;
    }

    if (state.mutableFullLocal !== undefined) {
      body.localGet(state.mutableFullLocal);
      emitMergedBytes(body, state, { baseLocal: state.mutableFullLocal });
      return;
    }

    const mergeBaseLocal = localMergeBaseForKnownBytes(state);

    if (mergeBaseLocal !== undefined) {
      body.localGet(mergeBaseLocal);
      emitMergedBytes(body, state, { baseLocal: mergeBaseLocal });
      return;
    }

    const fullLocalSources = localSourcesForAlias(fullRegAccess(reg), state, base);

    if (fullLocalSources !== undefined) {
      emitComposedLocalLaneSources(body, fullLocalSources);
      return;
    }

    emitLoadStateU32(body, stateOffset[reg]);
    if (base !== undefined) {
      emitMergedBytes(body, base);
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
      if (localSourceAt(startByte + index, pending, committed) !== undefined) {
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

  function emitExactSourceForAlias(
    source: LocalLaneSource,
    alias: RegisterAlias,
    options: WasmIrEmitValueOptions
  ): ValueWidth {
    body.localGet(source.local);

    if (source.bitOffset !== 0) {
      body.i32Const(source.bitOffset).i32ShrU();
    }

    if (options.signed === true && alias.width < fullWidth) {
      return emitSignExtendValueToWidth(body, alias.width as 8 | 16);
    }

    if (source.bitOffset === 0 && source.valueWidth <= alias.width) {
      return cleanValueWidth(alias.width);
    }

    if (options.widthInsensitive === true && alias.width < fullWidth) {
      return dirtyValueWidth(alias.width);
    }

    return emitMaskValueToWidth(body, alias.width);
  }

  function emitPartialStateStores(reg: Reg32, stores: readonly RegisterStoreOp[]): void {
    const baseOffset = stateOffset[reg];

    for (const store of stores) {
      if (store.kind === "store16") {
        emitStoreStateU16(body, baseOffset + store.byteIndex, () => {
          emitWordLocalLaneSourceForStore16(body, store.sources);
        });
        continue;
      }

      emitStoreStateU8(body, baseOffset + store.byteIndex, () => {
        emitLocalLaneSourceForStore8(body, store.source);
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
    const local = state.mutableFullLocal;

    if (local !== undefined && !localIsShared(state, local)) {
      return local;
    }

    return body.addLocal(wasmValueType.i32);
  }

  function ensureWritableRegisterLocal(reg: Reg32, state: RegValueState, base?: RegValueState): number {
    const fullSource = exactFullLocalSource(state);
    const local = state.mutableFullLocal;

    if (local !== undefined && !localIsShared(state, local)) {
      if (fullSource?.local === local && fullSource.bitOffset === 0) {
        return local;
      }

      emitFullValue(reg, state, base);
      body.localSet(local);
      recordFullLocalValue(state, local, { mutable: true });
      return local;
    }

    // Local-backed lane values may share the same Wasm local. Before mutating a
    // full-register cell in place, detach so other lanes keep seeing the old
    // logical value.
    const detachedLocal = body.addLocal(wasmValueType.i32);

    emitFullValue(reg, state, base);
    body.localSet(detachedLocal);
    recordFullLocalValue(state, detachedLocal, { mutable: true });
    return detachedLocal;
  }

  function canCopyLocalValue(state: RegValueState): boolean {
    // After pre-instruction exits are emitted, earlier exit blocks may still
    // store committed locals. Keep committed full-value locals stable from then
    // on; pending states remain safe to replace with copied local-backed values.
    return preserveCommittedRegs || exactFullLocalSource(state) === undefined || !committedLocalIdentitiesPinned;
  }

  function mergeStateInto(target: RegValueState, source: RegValueState): void {
    const sourceFull = exactFullLocalSource(source);

    if (sourceFull !== undefined) {
      recordFullLocalValue(target, sourceFull.local, {
        mutable: source.mutableFullLocal === sourceFull.local
      });
      return;
    }

    mergePartialLocalValues(target, source);
  }

  function assertNoPending(): void {
    if (pendingStates.size !== 0) {
      throw new Error("JIT register pending writes were not committed");
    }
  }

  function localIsShared(owner: RegValueState, local: number): boolean {
    return stateMaps().some((states) =>
      [...states.values()].some((state) => state !== owner && stateUsesLocal(state, local))
    );
  }

  function stateMaps(): readonly Map<Reg32, RegValueState>[] {
    return [committedStates, pendingStates];
  }
}

function normalizeWriteSource(source: JitReg32WriteSource): Readonly<{
  emitValue: () => ValueWidth | void;
  sourceLocal?: number;
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
