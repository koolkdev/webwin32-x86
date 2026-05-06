import type { OperandWidth, RegisterAlias, Reg32 } from "#x86/isa/types.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import {
  emitCleanValueForFullUse,
  emitMaskValueToWidth,
  type WasmIrEmitValueOptions,
  type ValueWidth
} from "#backends/wasm/codegen/value-width.js";
import {
  allBytesKnown,
  cloneRegValueState,
  fullRegAccess,
  fullWidth,
  recordAliasLaneSources,
  recordFullStableLocal,
  recordPartialStableLocal,
  type FullRegisterLaneSources,
  type LocalLaneSource,
  type RegValueState
} from "./register-lanes.js";
import { emitStoreAliasValueIntoFullLocal } from "./register-emit.js";
import { stableLaneSourcesForAlias } from "./register-state-queries.js";
import {
  assertNoPending,
  commitPendingReg as commitPendingRegInStorage,
  createRegisterStateStorage,
  pendingRegs,
  writableMutableCells,
  writableStateForReg
} from "./register-state-storage.js";
import { emitReadRegisterAlias } from "./register-read.js";
import { emitStoreRegState } from "./register-state-store.js";
import { createRegisterValueEmitter } from "./register-value-emitter.js";

export type JitReg32InstructionOptions = Readonly<{
  preserveCommittedRegs: boolean;
}>;

export type JitReg32WriteSource = (() => ValueWidth | void) | Readonly<{
  emitValue: () => ValueWidth | void;
  laneSources?: FullRegisterLaneSources;
}>;

export type JitReg32ExitStoreSnapshot = ReadonlyMap<Reg32, RegValueState>;

export type JitReg32State = Readonly<{
  beginInstruction(options: JitReg32InstructionOptions): void;
  commitPending(): void;
  commitPendingReg(reg: Reg32): void;
  emitReadReg32(reg: Reg32): ValueWidth;
  emitReadAlias(alias: RegisterAlias, options?: WasmIrEmitValueOptions): ValueWidth;
  stableLaneSourcesForAlias(alias: RegisterAlias): readonly LocalLaneSource[] | undefined;
  ensureStableFullLaneSourcesForCopy(reg: Reg32): FullRegisterLaneSources;
  emitWriteAlias(alias: RegisterAlias, source: JitReg32WriteSource): void;
  emitWriteAliasIf(
    alias: RegisterAlias,
    emitCondition: () => ValueWidth | void,
    emitValue: () => ValueWidth | void
  ): void;
  captureCommittedExitStores(regs: readonly Reg32[]): JitReg32ExitStoreSnapshot;
  emitCommittedStore(reg: Reg32): void;
  emitExitSnapshotStore(reg: Reg32, snapshot: JitReg32ExitStoreSnapshot): void;
}>;

export function createJitReg32State(body: WasmFunctionBodyEncoder): JitReg32State {
  const storage = createRegisterStateStorage();
  const values = createRegisterValueEmitter(body, storage);
  let preserveCommittedRegs = false;

  return {
    beginInstruction: (options) => {
      assertNoPending(storage);
      preserveCommittedRegs = options.preserveCommittedRegs;
    },
    emitReadReg32: (reg) => emitReadAlias(fullRegAccess(reg)),
    emitReadAlias,
    stableLaneSourcesForAlias: (alias) => stableLaneSourcesForAlias(storage, alias),
    ensureStableFullLaneSourcesForCopy: values.ensureStableFullLaneSourcesForCopy,
    emitWriteAlias,
    emitWriteAliasIf,
    captureCommittedExitStores,
    commitPending,
    commitPendingReg,
    emitCommittedStore,
    emitExitSnapshotStore: (reg, snapshot) => {
      const state = snapshot.get(reg);

      if (state === undefined) {
        throw new Error(`JIT register snapshot has no state for ${reg}`);
      }

      emitStoreRegState(body, reg, state);
    }
  };

  function emitReadAlias(alias: RegisterAlias, options: WasmIrEmitValueOptions = {}): ValueWidth {
    return emitReadRegisterAlias(body, storage, values, alias, options);
  }

  function emitWriteAlias(alias: RegisterAlias, source: JitReg32WriteSource): void {
    const writeSource = normalizeWriteSource(source);
    const state = writableStateForReg(storage, alias.base, preserveCommittedRegs);

    if (alias.width === fullWidth) {
      writableMutableCells(storage, preserveCommittedRegs).delete(alias.base);

      if (writeSource.laneSources !== undefined) {
        recordAliasLaneSources(state, alias, writeSource.laneSources);
        return;
      }

      emitCleanValueForFullUse(body, writeSource.emitValue() ?? undefined);
      const local = body.addLocal(wasmValueType.i32);

      body.localSet(local);
      recordFullStableLocal(state, local);
      return;
    }

    const valueLocal = localForMaskedValue(alias.width, writeSource.emitValue);

    recordPartialStableLocal(state, alias, valueLocal);

    if (allBytesKnown(state)) {
      writableMutableCells(storage, preserveCommittedRegs).delete(alias.base);
    }
  }

  function emitWriteAliasIf(
    alias: RegisterAlias,
    emitCondition: () => ValueWidth | void,
    emitValue: () => ValueWidth | void
  ): void {
    const local = values.ensureMutableCell(alias.base, preserveCommittedRegs);

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

  function captureCommittedExitStores(regs: readonly Reg32[]): JitReg32ExitStoreSnapshot {
    const snapshot = new Map<Reg32, RegValueState>();

    for (const reg of regs) {
      values.freezeCommittedRegister(reg);

      const state = storage.committedStates.get(reg);

      if (state === undefined) {
        throw new Error(`dirty JIT register has no committed state: ${reg}`);
      }

      snapshot.set(reg, cloneRegValueState(state));
    }

    return snapshot;
  }

  function commitPending(): void {
    for (const reg of pendingRegs(storage)) {
      commitPendingReg(reg);
    }

    preserveCommittedRegs = false;
  }

  function commitPendingReg(reg: Reg32): void {
    commitPendingRegInStorage(storage, reg);
  }

  function emitCommittedStore(reg: Reg32): void {
    values.freezeCommittedRegister(reg);

    const state = storage.committedStates.get(reg);

    if (state === undefined) {
      throw new Error(`dirty JIT register has no committed state: ${reg}`);
    }

    emitStoreRegState(body, reg, state);
  }

  function localForMaskedValue(width: OperandWidth, emitValue: () => ValueWidth | void): number {
    const local = body.addLocal(wasmValueType.i32);

    emitMaskValueToWidth(body, width, emitValue() ?? undefined);
    body.localSet(local);
    return local;
  }
}

function normalizeWriteSource(source: JitReg32WriteSource): Readonly<{
  emitValue: () => ValueWidth | void;
  laneSources?: FullRegisterLaneSources;
}> {
  return typeof source === "function" ? { emitValue: source } : source;
}
