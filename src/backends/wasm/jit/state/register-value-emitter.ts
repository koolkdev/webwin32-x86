import type { Reg32 } from "#x86/isa/types.js";
import { stateOffset } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import { emitLoadStateU32 } from "#backends/wasm/codegen/state.js";
import {
  clearKnownBytes,
  exactFullLocal,
  fullRegAccess,
  fullRegisterLaneSourcesFrom,
  hasKnownBytes,
  laneSourcesForAlias,
  recordFullStableLocal,
  retainFullRegisterLaneSources,
  stableFullLaneSources,
  type FullRegisterLaneSources
} from "./register-lanes.js";
import {
  emitComposedLocalLaneSources,
  emitMergedBytes
} from "./register-emit.js";
import {
  currentUncoveredMutableCell,
  currentValueUsesMutableCell,
  exactStableSourceForAlias,
  stableLaneSourcesForAlias
} from "./register-state-queries.js";
import {
  committedStateForReg,
  stateForReg,
  writableMutableCells,
  writableStateForReg,
  type RegisterStateStorage
} from "./register-state-storage.js";

export type RegisterValueEmitter = Readonly<{
  materializeCurrentFull(reg: Reg32): number;
  emitCurrentFullValue(reg: Reg32): void;
  emitCommittedFullValue(reg: Reg32): void;
  ensureStableFullLaneSourcesForCopy(reg: Reg32): FullRegisterLaneSources;
  freezeMutableRegister(reg: Reg32): FullRegisterLaneSources;
  freezeCommittedRegister(reg: Reg32): void;
  ensureMutableCell(reg: Reg32, preserveCommittedRegs: boolean): number;
}>;

export function createRegisterValueEmitter(
  body: WasmFunctionBodyEncoder,
  storage: RegisterStateStorage
): RegisterValueEmitter {
  return {
    materializeCurrentFull,
    emitCurrentFullValue,
    emitCommittedFullValue,
    ensureStableFullLaneSourcesForCopy,
    freezeMutableRegister,
    freezeCommittedRegister,
    ensureMutableCell
  };

  function ensureStableFullLaneSourcesForCopy(reg: Reg32): FullRegisterLaneSources {
    const stableSources = fullRegisterLaneSourcesFrom(stableLaneSourcesForAlias(storage, fullRegAccess(reg)));

    if (stableSources !== undefined) {
      return retainFullRegisterLaneSources(stableSources);
    }

    if (currentValueUsesMutableCell(storage, reg)) {
      return freezeMutableRegister(reg);
    }

    const local = materializeCurrentFull(reg);

    return stableFullLaneSources(local);
  }

  function freezeMutableRegister(reg: Reg32): FullRegisterLaneSources {
    if (!currentValueUsesMutableCell(storage, reg)) {
      return ensureStableFullLaneSourcesForCopy(reg);
    }

    const local = body.addLocal(wasmValueType.i32);

    emitCurrentFullValue(reg);
    body.localSet(local);
    recordCurrentFullStableLocal(reg, local);

    return stableFullLaneSources(local);
  }

  function materializeCurrentFull(reg: Reg32): number {
    const fullSource = exactStableSourceForAlias(storage, fullRegAccess(reg));

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

    if (pending !== undefined) {
      const pendingMutableLocal = storage.pendingMutableCells.get(reg);

      if (pendingMutableLocal !== undefined) {
        body.localGet(pendingMutableLocal);
        emitMergedBytes(body, pending, { baseLocal: pendingMutableLocal });
        return;
      }

      const pendingFullSource = exactFullLocal(pending);

      if (pendingFullSource !== undefined) {
        body.localGet(pendingFullSource.local);
        return;
      }

      const pendingSources = laneSourcesForAlias(pending, fullRegAccess(reg));

      if (pendingSources !== undefined) {
        emitComposedLocalLaneSources(body, pendingSources);
        return;
      }

      emitCommittedFullValue(reg);
      emitMergedBytes(body, pending);
      return;
    }

    emitCommittedFullValue(reg);
  }

  function emitCommittedFullValue(reg: Reg32): void {
    const state = storage.committedStates.get(reg);
    const mutableLocal = storage.committedMutableCells.get(reg);

    if (mutableLocal !== undefined) {
      body.localGet(mutableLocal);

      if (state !== undefined) {
        emitMergedBytes(body, state, { baseLocal: mutableLocal });
      }
      return;
    }

    const fullSource = exactFullLocal(state);

    if (fullSource !== undefined) {
      body.localGet(fullSource.local);
      return;
    }

    const sources = laneSourcesForAlias(state, fullRegAccess(reg));

    if (sources !== undefined) {
      emitComposedLocalLaneSources(body, sources);
      return;
    }

    emitLoadStateU32(body, stateOffset[reg]);

    if (state !== undefined) {
      emitMergedBytes(body, state);
    }
  }

  function ensureMutableCell(reg: Reg32, preserveCommittedRegs: boolean): number {
    const state = writableStateForReg(storage, reg, preserveCommittedRegs);
    const cells = writableMutableCells(storage, preserveCommittedRegs);
    const local = cells.get(reg);

    if (local !== undefined) {
      if (hasKnownBytes(state)) {
        emitCurrentFullValue(reg);
        body.localSet(local);
        clearKnownBytes(state);
      }

      return local;
    }

    const detachedLocal = body.addLocal(wasmValueType.i32);

    emitCurrentFullValue(reg);
    body.localSet(detachedLocal);
    clearKnownBytes(state);
    cells.set(reg, detachedLocal);
    return detachedLocal;
  }

  function freezeCommittedRegister(reg: Reg32): void {
    if (!storage.committedMutableCells.has(reg)) {
      return;
    }

    const local = body.addLocal(wasmValueType.i32);

    emitCommittedFullValue(reg);
    body.localSet(local);
    recordFullStableLocal(committedStateForReg(storage, reg), local);
    storage.committedMutableCells.delete(reg);
  }

  function recordCurrentFullStableLocal(reg: Reg32, local: number): void {
    if (storage.pendingStates.has(reg) || storage.pendingMutableCells.has(reg)) {
      recordFullStableLocal(stateForReg(storage.pendingStates, reg), local);
      storage.pendingMutableCells.delete(reg);
      return;
    }

    recordFullStableLocal(committedStateForReg(storage, reg), local);
    storage.committedMutableCells.delete(reg);
  }
}
