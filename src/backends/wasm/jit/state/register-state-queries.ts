import type { RegisterAlias, Reg32 } from "#x86/isa/types.js";
import {
  aliasByteRange,
  allBytesKnown,
  exactLocalForLaneSources,
  hasKnownBytes,
  localSourceAt,
  type LocalLaneSource
} from "./register-lanes.js";
import type { RegisterStateStorage } from "./register-state-storage.js";

export function stableLaneSourcesForAlias(
  storage: RegisterStateStorage,
  alias: RegisterAlias
): readonly LocalLaneSource[] | undefined {
  const { startByte, byteLength } = aliasByteRange(alias);
  const sources: LocalLaneSource[] = [];

  for (let index = 0; index < byteLength; index += 1) {
    const source = currentStableSourceAt(storage, alias.base, startByte + index);

    if (source === undefined) {
      return undefined;
    }

    sources.push(source);
  }

  return sources;
}

export function exactStableSourceForAlias(
  storage: RegisterStateStorage,
  alias: RegisterAlias
): LocalLaneSource | undefined {
  return exactLocalForLaneSources(stableLaneSourcesForAlias(storage, alias), alias.width);
}

export function currentStableSourceAt(
  storage: RegisterStateStorage,
  reg: Reg32,
  byteIndex: number
): LocalLaneSource | undefined {
  const pending = storage.pendingStates.get(reg);

  if (pending !== undefined) {
    const pendingSource = localSourceAt(pending, byteIndex);

    if (pendingSource !== undefined) {
      return pendingSource;
    }

    if (storage.pendingMutableCells.has(reg)) {
      return undefined;
    }
  }

  const committedSource = localSourceAt(storage.committedStates.get(reg), byteIndex);

  if (committedSource !== undefined) {
    return committedSource;
  }

  return undefined;
}

export function currentByteUsesMutableCell(
  storage: RegisterStateStorage,
  reg: Reg32,
  byteIndex: number
): boolean {
  const pending = storage.pendingStates.get(reg);

  if (pending !== undefined) {
    if (localSourceAt(pending, byteIndex) !== undefined) {
      return false;
    }

    if (storage.pendingMutableCells.has(reg)) {
      return true;
    }
  }

  if (localSourceAt(storage.committedStates.get(reg), byteIndex) !== undefined) {
    return false;
  }

  return storage.committedMutableCells.has(reg);
}

export function currentValueUsesMutableCell(storage: RegisterStateStorage, reg: Reg32): boolean {
  const pending = storage.pendingStates.get(reg);

  if (pending !== undefined) {
    return storage.pendingMutableCells.has(reg) ||
      (storage.committedMutableCells.has(reg) && !allBytesKnown(pending));
  }

  return storage.committedMutableCells.has(reg);
}

export function currentUncoveredMutableCell(storage: RegisterStateStorage, reg: Reg32): number | undefined {
  const pending = storage.pendingStates.get(reg);
  const pendingMutableLocal = storage.pendingMutableCells.get(reg);

  if (pendingMutableLocal !== undefined && (pending === undefined || !hasKnownBytes(pending))) {
    return pendingMutableLocal;
  }

  if (pending !== undefined && hasKnownBytes(pending)) {
    return undefined;
  }

  const committedMutableLocal = storage.committedMutableCells.get(reg);
  const committed = storage.committedStates.get(reg);

  if (committedMutableLocal !== undefined && (committed === undefined || !hasKnownBytes(committed))) {
    return committedMutableLocal;
  }

  return undefined;
}
