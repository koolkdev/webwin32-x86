import type { RegisterAlias, Reg32 } from "#x86/isa/types.js";
import {
  aliasOverlapsKnownPrefix,
  exactSourceForAlias,
  fullRegAccess,
  hasFullValue,
  hasKnownPrefix,
  knownPrefixForAlias,
  knownPrefixForReg,
  type LocalRegValueSource
} from "./register-values.js";
import type { RegisterStateStorage } from "./register-state-storage.js";

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

  if (pending !== undefined) {
    const pendingPrefix = knownPrefixForReg(pending);

    if (pendingPrefix !== undefined || storage.pendingMutableCells.has(reg)) {
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

  if (pending !== undefined) {
    if (aliasOverlapsKnownPrefix(pending, alias) || storage.pendingMutableCells.has(alias.base)) {
      return false;
    }
  }

  const committed = storage.committedStates.get(alias.base);

  if (aliasOverlapsKnownPrefix(committed, alias) || storage.committedMutableCells.has(alias.base)) {
    return false;
  }

  return true;
}

export function currentValueUsesMutableCell(storage: RegisterStateStorage, reg: Reg32): boolean {
  if (storage.pendingMutableCells.has(reg)) {
    return true;
  }

  const pending = storage.pendingStates.get(reg);

  if (pending !== undefined) {
    return !hasFullValue(pending) && storage.committedMutableCells.has(reg);
  }

  return storage.committedMutableCells.has(reg);
}

export function currentUncoveredMutableCell(storage: RegisterStateStorage, reg: Reg32): number | undefined {
  const pending = storage.pendingStates.get(reg);
  const pendingMutableLocal = storage.pendingMutableCells.get(reg);

  if (pendingMutableLocal !== undefined && !hasKnownPrefix(pending)) {
    return pendingMutableLocal;
  }

  if (pending !== undefined && hasKnownPrefix(pending)) {
    return undefined;
  }

  const committedMutableLocal = storage.committedMutableCells.get(reg);

  if (committedMutableLocal !== undefined && !hasKnownPrefix(storage.committedStates.get(reg))) {
    return committedMutableLocal;
  }

  return undefined;
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

  if (pending !== undefined) {
    const pendingSource = select(pending, alias);

    if (pendingSource !== undefined) {
      return pendingSource;
    }

    if (aliasOverlapsKnownPrefix(pending, alias) || storage.pendingMutableCells.has(alias.base)) {
      return undefined;
    }
  }

  return select(storage.committedStates.get(alias.base), alias);
}

export function currentExactFullSource(
  storage: RegisterStateStorage,
  reg: Reg32
): LocalRegValueSource | undefined {
  return currentExactSourceForAlias(storage, fullRegAccess(reg));
}
