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
  clearRegValueState,
  cloneRegValueState,
  fullRegAccess,
  fullWidth,
  recordRegValueSource,
  recordStableRegValue,
  type LocalRegValueSource,
  type RegValueState
} from "./register-values.js";
import {
  emitComposedPrefixLocal,
  emitStoreAliasValueIntoFullLocal
} from "./register-emit.js";
import { currentKnownPrefixForAlias, currentKnownPrefixForReg } from "./register-state-queries.js";
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
  prefixSource?: LocalRegValueSource | undefined;
}>;

export type JitReg32ExitStoreSnapshot = ReadonlyMap<Reg32, RegValueState>;

export type JitReg32State = Readonly<{
  beginInstruction(options: JitReg32InstructionOptions): void;
  commitPending(): void;
  commitPendingReg(reg: Reg32): void;
  emitReadReg32(reg: Reg32): ValueWidth;
  emitReadAlias(alias: RegisterAlias, options?: WasmIrEmitValueOptions): ValueWidth;
  knownPrefixForAlias(alias: RegisterAlias): LocalRegValueSource | undefined;
  ensureStableFullValueForCopy(reg: Reg32): LocalRegValueSource;
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
    knownPrefixForAlias: (alias) => currentKnownPrefixForAlias(storage, alias),
    ensureStableFullValueForCopy: values.ensureStableFullValueForCopy,
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
    const currentPrefix = currentKnownPrefixForReg(storage, alias.base);
    const state = writableStateForReg(storage, alias.base, preserveCommittedRegs);

    if (alias.width === fullWidth) {
      writableMutableCells(storage, preserveCommittedRegs).delete(alias.base);

      if (writeSource.prefixSource !== undefined) {
        if (writeSource.prefixSource.width !== fullWidth) {
          throw new Error(`full-register writes need a 32-bit prefix source, got ${writeSource.prefixSource.width}`);
        }

        recordRegValueSource(state, writeSource.prefixSource);
        return;
      }

      emitCleanValueForFullUse(body, writeSource.emitValue() ?? undefined);
      const local = body.addLocal(wasmValueType.i32);

      body.localSet(local);
      recordStableRegValue(state, local, fullWidth);
      return;
    }

    if (alias.bitOffset !== 0) {
      // High-byte and other non-prefix aliases fall back to a mutable full register.
      const fullLocal = values.ensureMutableCell(alias.base, preserveCommittedRegs);
      const valueLocal = localForMaskedValue(alias.width, writeSource.emitValue);

      emitStoreAliasValueIntoFullLocal(body, fullLocal, alias, valueLocal);
      clearRegValueState(state);
      return;
    }

    const valueLocal = localForMaskedValue(alias.width, writeSource.emitValue);
    const composedWidth = composedWriteWidth(currentPrefix, alias.width);

    if (composedWidth !== undefined && currentPrefix !== undefined) {
      // Keep AL/AX writes in the prefix model by composing them into the known low bits.
      const composedLocal = emitComposedPrefixLocal(body, currentPrefix, valueLocal, alias.width);

      recordStableRegValue(state, composedLocal, composedWidth);

      if (composedWidth === fullWidth) {
        writableMutableCells(storage, preserveCommittedRegs).delete(alias.base);
      }
      return;
    }

    recordStableRegValue(state, valueLocal, alias.width);
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

function composedWriteWidth(
  currentPrefix: LocalRegValueSource | undefined,
  writeWidth: OperandWidth
): 16 | 32 | undefined {
  if (currentPrefix?.width === 32 && (writeWidth === 8 || writeWidth === 16)) {
    return 32;
  }

  if (currentPrefix?.width === 16 && writeWidth === 8) {
    return 16;
  }

  return undefined;
}

function normalizeWriteSource(source: JitReg32WriteSource): Readonly<{
  emitValue: () => ValueWidth | void;
  prefixSource?: LocalRegValueSource | undefined;
}> {
  return typeof source === "function" ? { emitValue: source } : source;
}
