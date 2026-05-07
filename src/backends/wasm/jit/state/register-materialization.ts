import type { Reg32 } from "#x86/isa/types.js";
import { stateOffset } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import { emitLoadStateU32 } from "#backends/wasm/codegen/state.js";
import {
  clearRegValueState,
  hasKnownPrefix,
  recordStableRegValue,
  retainedRegValueSource,
  type LocalRegValueSource
} from "./register-values.js";
import {
  clearWritableMutableCell,
  committedMutableCell,
  committedStateForReg,
  currentExactFullSource,
  currentUncoveredMutableCell,
  currentValueUsesMutableCell,
  hasCommittedMutableCell,
  pendingMutableCell,
  recordWritableMutableCell,
  writableStateForReg,
  type RegisterStateStorage
} from "./register-storage.js";
import { emitMergedPrefix } from "./register-prefix-emit.js";

export type RegisterMaterializer = Readonly<{
  materializeCurrentFull(reg: Reg32): number;
  emitCurrentFullValue(reg: Reg32): void;
  emitCommittedFullValue(reg: Reg32): void;
  ensureStableFullValueForCopy(reg: Reg32): LocalRegValueSource;
  freezeMutableRegister(reg: Reg32): LocalRegValueSource;
  freezeCommittedRegister(reg: Reg32): void;
  ensureMutableCell(reg: Reg32, preserveCommittedRegs: boolean): number;
}>;

export function createRegisterMaterializer(
  body: WasmFunctionBodyEncoder,
  storage: RegisterStateStorage
): RegisterMaterializer {
  return {
    materializeCurrentFull,
    emitCurrentFullValue,
    emitCommittedFullValue,
    ensureStableFullValueForCopy,
    freezeMutableRegister,
    freezeCommittedRegister,
    ensureMutableCell
  };

  function ensureStableFullValueForCopy(reg: Reg32): LocalRegValueSource {
    const stableSource = currentExactFullSource(storage, reg);

    if (stableSource !== undefined) {
      return retainedRegValueSource(stableSource);
    }

    if (currentValueUsesMutableCell(storage, reg)) {
      return freezeMutableRegister(reg);
    }

    const local = materializeCurrentFull(reg);

    return { kind: "local", local, width: 32 };
  }

  function freezeMutableRegister(reg: Reg32): LocalRegValueSource {
    if (!currentValueUsesMutableCell(storage, reg)) {
      return ensureStableFullValueForCopy(reg);
    }

    const local = body.addLocal(wasmValueType.i32);

    emitCurrentFullValue(reg);
    body.localSet(local);
    recordCurrentFullStableLocal(reg, local);

    return { kind: "local", local, width: 32 };
  }

  function materializeCurrentFull(reg: Reg32): number {
    const fullSource = currentExactFullSource(storage, reg);

    if (fullSource !== undefined) {
      return fullSource.local;
    }

    const mutableLocal = currentUncoveredMutableCell(storage, reg);

    if (mutableLocal !== undefined) {
      return mutableLocal;
    }

    const local = body.addLocal(wasmValueType.i32);

    emitCurrentFullValue(reg);
    body.localSet(local);
    recordCurrentFullStableLocal(reg, local);
    return local;
  }

  function emitCurrentFullValue(reg: Reg32): void {
    const pending = storage.pendingStates.get(reg);
    const pendingMutableLocal = pendingMutableCell(storage, reg);

    if (pendingMutableLocal !== undefined) {
      body.localGet(pendingMutableLocal);
      emitMergedPrefix(body, pending, { baseLocal: pendingMutableLocal });
      return;
    }

    if (pending !== undefined) {
      if (pending.kind === "local" && pending.width === 32) {
        body.localGet(pending.local);
        return;
      }

      emitCommittedFullValue(reg);
      emitMergedPrefix(body, pending);
      return;
    }

    emitCommittedFullValue(reg);
  }

  function emitCommittedFullValue(reg: Reg32): void {
    const state = storage.committedStates.get(reg);
    const mutableLocal = committedMutableCell(storage, reg);

    if (mutableLocal !== undefined) {
      body.localGet(mutableLocal);
      emitMergedPrefix(body, state, { baseLocal: mutableLocal });
      return;
    }

    if (state?.kind === "local" && state.width === 32) {
      body.localGet(state.local);
      return;
    }

    emitLoadStateU32(body, stateOffset[reg]);
    emitMergedPrefix(body, state);
  }

  function ensureMutableCell(reg: Reg32, preserveCommittedRegs: boolean): number {
    const state = writableStateForReg(storage, reg, preserveCommittedRegs);
    const local = preserveCommittedRegs
      ? pendingMutableCell(storage, reg)
      : committedMutableCell(storage, reg);

    if (local !== undefined) {
      if (hasKnownPrefix(state)) {
        emitCurrentFullValue(reg);
        body.localSet(local);
        clearRegValueState(state);
      }

      return local;
    }

    const detachedLocal = body.addLocal(wasmValueType.i32);

    emitCurrentFullValue(reg);
    body.localSet(detachedLocal);
    clearRegValueState(state);
    recordWritableMutableCell(storage, reg, detachedLocal, preserveCommittedRegs);
    return detachedLocal;
  }

  function freezeCommittedRegister(reg: Reg32): void {
    if (!hasCommittedMutableCell(storage, reg)) {
      return;
    }

    const local = body.addLocal(wasmValueType.i32);

    emitCommittedFullValue(reg);
    body.localSet(local);
    recordStableRegValue(committedStateForReg(storage, reg), local, 32);
    clearWritableMutableCell(storage, reg, false);
  }

  function recordCurrentFullStableLocal(reg: Reg32, local: number): void {
    if (storage.pendingStates.has(reg) || pendingMutableCell(storage, reg) !== undefined) {
      recordStableRegValue(writableStateForReg(storage, reg, true), local, 32);
      clearWritableMutableCell(storage, reg, true);
      return;
    }

    recordStableRegValue(committedStateForReg(storage, reg), local, 32);
    clearWritableMutableCell(storage, reg, false);
  }
}
