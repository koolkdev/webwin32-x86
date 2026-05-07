import type { RegisterAlias, Reg32 } from "#x86/isa/types.js";
import {
  aliasOverlapsKnownPrefix,
  clearRegValueState,
  emptyRegValueState,
  exactSourceForAlias,
  fullRegAccess,
  hasFullValue,
  hasKnownPrefix,
  knownPrefixForAlias,
  knownPrefixForReg,
  moveRegValueState,
  type LocalRegValueSource,
  type RegValueState
} from "./register-values.js";

type RegisterMutableCells = Map<Reg32, number>;

type RegisterMutableCellStorage = {
  committedMutableCells: RegisterMutableCells;
  pendingMutableCells: RegisterMutableCells;
};

export type RegisterStateStorage = Readonly<{
  committedStates: Map<Reg32, RegValueState>;
  pendingStates: Map<Reg32, RegValueState>;
  mutableCells: RegisterMutableCellStorage;
}>;

export function createRegisterStateStorage(): RegisterStateStorage {
  return {
    committedStates: new Map(),
    pendingStates: new Map(),
    mutableCells: {
      committedMutableCells: new Map(),
      pendingMutableCells: new Map()
    }
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

export function clearWritableMutableCell(
  storage: RegisterStateStorage,
  reg: Reg32,
  preserveCommittedRegs: boolean
): void {
  mutableCellsForWrite(storage, preserveCommittedRegs).delete(reg);
}

export function recordWritableMutableCell(
  storage: RegisterStateStorage,
  reg: Reg32,
  local: number,
  preserveCommittedRegs: boolean
): void {
  mutableCellsForWrite(storage, preserveCommittedRegs).set(reg, local);
}

export function committedMutableCell(storage: RegisterStateStorage, reg: Reg32): number | undefined {
  return storage.mutableCells.committedMutableCells.get(reg);
}

export function pendingMutableCell(storage: RegisterStateStorage, reg: Reg32): number | undefined {
  return storage.mutableCells.pendingMutableCells.get(reg);
}

export function hasCommittedMutableCell(storage: RegisterStateStorage, reg: Reg32): boolean {
  return storage.mutableCells.committedMutableCells.has(reg);
}

function mutableCellsForWrite(
  storage: RegisterStateStorage,
  preserveCommittedRegs: boolean
): RegisterMutableCells {
  return preserveCommittedRegs
    ? storage.mutableCells.pendingMutableCells
    : storage.mutableCells.committedMutableCells;
}

export function commitPendingReg(storage: RegisterStateStorage, reg: Reg32): void {
  const pending = storage.pendingStates.get(reg);
  const mutableCells = storage.mutableCells;
  const pendingMutableLocal = mutableCells.pendingMutableCells.get(reg);

  if (pending === undefined && pendingMutableLocal === undefined) {
    return;
  }

  const target = committedStateForReg(storage, reg);

  if (pending !== undefined) {
    moveRegValueState(target, pending);
  } else if (pendingMutableLocal !== undefined) {
    clearRegValueState(target);
  }

  if (pendingMutableLocal !== undefined) {
    mutableCells.committedMutableCells.set(reg, pendingMutableLocal);
  } else if (target.kind === "local" && target.width === 32) {
    mutableCells.committedMutableCells.delete(reg);
  }

  storage.pendingStates.delete(reg);
  mutableCells.pendingMutableCells.delete(reg);
}

export function pendingRegs(storage: RegisterStateStorage): readonly Reg32[] {
  return [...new Set([...storage.pendingStates.keys(), ...storage.mutableCells.pendingMutableCells.keys()])];
}

export function assertNoPending(storage: RegisterStateStorage): void {
  if (storage.pendingStates.size !== 0 || storage.mutableCells.pendingMutableCells.size !== 0) {
    throw new Error("JIT register pending writes were not committed");
  }
}

export function currentKnownPrefixForAlias(
  storage: RegisterStateStorage,
  alias: RegisterAlias
): LocalRegValueSource | undefined {
  return currentSourceForAlias(storage, alias, knownPrefixForAlias);
}

export function currentExactSourceForAlias(
  storage: RegisterStateStorage,
  alias: RegisterAlias
): LocalRegValueSource | undefined {
  return currentSourceForAlias(storage, alias, exactSourceForAlias);
}

export function currentKnownPrefixForReg(
  storage: RegisterStateStorage,
  reg: Reg32
): LocalRegValueSource | undefined {
  const pending = storage.pendingStates.get(reg);
  const mutableCells = storage.mutableCells;

  if (pending !== undefined) {
    const pendingPrefix = knownPrefixForReg(pending);

    if (pendingPrefix !== undefined || mutableCells.pendingMutableCells.has(reg)) {
      return pendingPrefix;
    }
  }

  return knownPrefixForReg(storage.committedStates.get(reg));
}

export function currentAliasCanLoadFromState(
  storage: RegisterStateStorage,
  alias: RegisterAlias
): boolean {
  const pending = storage.pendingStates.get(alias.base);
  const mutableCells = storage.mutableCells;

  if (pending !== undefined) {
    if (aliasOverlapsKnownPrefix(pending, alias) || mutableCells.pendingMutableCells.has(alias.base)) {
      return false;
    }
  }

  const committed = storage.committedStates.get(alias.base);

  if (aliasOverlapsKnownPrefix(committed, alias) || mutableCells.committedMutableCells.has(alias.base)) {
    return false;
  }

  return true;
}

export function currentValueUsesMutableCell(storage: RegisterStateStorage, reg: Reg32): boolean {
  const mutableCells = storage.mutableCells;

  if (mutableCells.pendingMutableCells.has(reg)) {
    return true;
  }

  const pending = storage.pendingStates.get(reg);

  if (pending !== undefined) {
    return !hasFullValue(pending) && mutableCells.committedMutableCells.has(reg);
  }

  return mutableCells.committedMutableCells.has(reg);
}

export function currentUncoveredMutableCell(storage: RegisterStateStorage, reg: Reg32): number | undefined {
  const pending = storage.pendingStates.get(reg);
  const mutableCells = storage.mutableCells;
  const pendingMutableLocal = mutableCells.pendingMutableCells.get(reg);

  if (pendingMutableLocal !== undefined && !hasKnownPrefix(pending)) {
    return pendingMutableLocal;
  }

  if (pending !== undefined && hasKnownPrefix(pending)) {
    return undefined;
  }

  const committedMutableLocal = mutableCells.committedMutableCells.get(reg);

  if (committedMutableLocal !== undefined && !hasKnownPrefix(storage.committedStates.get(reg))) {
    return committedMutableLocal;
  }

  return undefined;
}

export function currentExactFullSource(
  storage: RegisterStateStorage,
  reg: Reg32
): LocalRegValueSource | undefined {
  return currentExactSourceForAlias(storage, fullRegAccess(reg));
}

function currentSourceForAlias(
  storage: RegisterStateStorage,
  alias: RegisterAlias,
  select: (
    state: Parameters<typeof exactSourceForAlias>[0],
    alias: RegisterAlias
  ) => LocalRegValueSource | undefined
): LocalRegValueSource | undefined {
  const pending = storage.pendingStates.get(alias.base);
  const mutableCells = storage.mutableCells;

  if (pending !== undefined) {
    const pendingSource = select(pending, alias);

    if (pendingSource !== undefined) {
      return pendingSource;
    }

    if (aliasOverlapsKnownPrefix(pending, alias) || mutableCells.pendingMutableCells.has(alias.base)) {
      return undefined;
    }
  }

  return select(storage.committedStates.get(alias.base), alias);
}

function stateForReg(states: Map<Reg32, RegValueState>, reg: Reg32): RegValueState {
  let state = states.get(reg);

  if (state === undefined) {
    state = emptyRegValueState();
    states.set(reg, state);
  }

  return state;
}
