import type { Reg32 } from "#x86/isa/types.js";
import {
  allBytesKnown,
  emptyRegValueState,
  localSourceAt,
  type RegValueState
} from "./register-lanes.js";

type RegisterMutableCells = Map<Reg32, number>;

export type RegisterStateStorage = Readonly<{
  committedStates: Map<Reg32, RegValueState>;
  pendingStates: Map<Reg32, RegValueState>;
  committedMutableCells: RegisterMutableCells;
  pendingMutableCells: RegisterMutableCells;
}>;

export function createRegisterStateStorage(): RegisterStateStorage {
  return {
    committedStates: new Map(),
    pendingStates: new Map(),
    committedMutableCells: new Map(),
    pendingMutableCells: new Map()
  };
}

export function committedStateForReg(storage: RegisterStateStorage, reg: Reg32): RegValueState {
  return stateForReg(storage.committedStates, reg);
}

export function writableStateForReg(
  storage: RegisterStateStorage,
  reg: Reg32,
  preserveCommittedRegs: boolean
): RegValueState {
  return preserveCommittedRegs
    ? stateForReg(storage.pendingStates, reg)
    : committedStateForReg(storage, reg);
}

export function writableMutableCells(
  storage: RegisterStateStorage,
  preserveCommittedRegs: boolean
): RegisterMutableCells {
  return preserveCommittedRegs ? storage.pendingMutableCells : storage.committedMutableCells;
}

export function commitPendingReg(storage: RegisterStateStorage, reg: Reg32): void {
  const pending = storage.pendingStates.get(reg);
  const pendingMutableLocal = storage.pendingMutableCells.get(reg);

  if (pending === undefined && pendingMutableLocal === undefined) {
    return;
  }

  const target = committedStateForReg(storage, reg);

  if (pendingMutableLocal !== undefined) {
    target.bytes = pending === undefined ? emptyRegValueState().bytes : [...pending.bytes];
    storage.committedMutableCells.set(reg, pendingMutableLocal);
  } else if (pending !== undefined && allBytesKnown(pending)) {
    target.bytes = [...pending.bytes];
    storage.committedMutableCells.delete(reg);
  } else if (pending !== undefined) {
    for (let byteIndex = 0; byteIndex < pending.bytes.length; byteIndex += 1) {
      const source = localSourceAt(pending, byteIndex);

      if (source !== undefined) {
        target.bytes[byteIndex] = { kind: "value", source };
      }
    }
  }

  storage.pendingStates.delete(reg);
  storage.pendingMutableCells.delete(reg);
}

export function pendingRegs(storage: RegisterStateStorage): readonly Reg32[] {
  return [...new Set([...storage.pendingStates.keys(), ...storage.pendingMutableCells.keys()])];
}

export function assertNoPending(storage: RegisterStateStorage): void {
  if (storage.pendingStates.size !== 0 || storage.pendingMutableCells.size !== 0) {
    throw new Error("JIT register pending writes were not committed");
  }
}

export function stateForReg(states: Map<Reg32, RegValueState>, reg: Reg32): RegValueState {
  let state = states.get(reg);

  if (state === undefined) {
    state = emptyRegValueState();
    states.set(reg, state);
  }

  return state;
}
