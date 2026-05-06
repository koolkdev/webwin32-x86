import { widthMask, type OperandWidth, type RegisterAlias, type Reg32 } from "#x86/isa/types.js";

export type UnknownLaneSource = Readonly<{
  kind: "unknown";
}>;

export type LocalLaneSource = Readonly<{
  kind: "local";
  local: number;
  bitOffset: number;
  valueWidth: OperandWidth;
}>;

export type LocalBackedLaneValue = Readonly<{
  kind: "value";
  source: LocalLaneSource;
}>;

export type RegisterLaneValue = UnknownLaneSource | LocalBackedLaneValue;

export type RegValueState = {
  // Full-register architectural value, or unknown when bytes/CPU state define it.
  full: RegisterLaneValue;
  // Per-byte architectural values; unknown bytes still come from CPU state memory.
  bytes: RegisterLaneValue[];
  // Exact partial-width values for direct alias reads and efficient merges.
  partials: Map<string, LocalBackedLaneValue>;
  // Local this state may mutate in place; not part of architectural contents.
  mutableFullLocal?: number;
};

export type AliasByteRange = Readonly<{
  startByte: number;
  byteLength: number;
}>;

export type PartialLaneSource = Readonly<{
  bitOffset: RegisterAlias["bitOffset"];
  width: RegisterAlias["width"];
  source: LocalLaneSource;
}>;

type LaneRange = Readonly<{
  bitOffset: RegisterAlias["bitOffset"];
  width: RegisterAlias["width"];
}>;

export const fullWidth = 32;
export const byteWidth = 8;
export const byteMask = 0xff;
export const byteCount = 4;

const unknownLaneSource: UnknownLaneSource = { kind: "unknown" };

export function emptyRegValueState(): RegValueState {
  return {
    full: unknownLaneSource,
    bytes: new Array<RegisterLaneValue>(byteCount).fill(unknownLaneSource),
    partials: new Map()
  };
}

export function isLocalBackedLaneValue(value: RegisterLaneValue | undefined): value is LocalBackedLaneValue {
  return value?.kind === "value" && value.source.kind === "local";
}

export function hasPartialLocalValues(state: RegValueState): boolean {
  return state.bytes.some(isLocalBackedLaneValue);
}

export function allBytesHaveLocalValues(state: RegValueState): boolean {
  return state.bytes.every(isLocalBackedLaneValue);
}

export function exactFullLocalSource(state: RegValueState | undefined): LocalLaneSource | undefined {
  return localSourceForLaneValue(state?.full);
}

export function fullRegAccess(reg: Reg32): RegisterAlias {
  return { name: reg, base: reg, bitOffset: 0, width: fullWidth };
}

export function aliasMask(alias: RegisterAlias): number {
  return (widthMask(alias.width) << alias.bitOffset) >>> 0;
}

export function aliasByteRange(alias: RegisterAlias): AliasByteRange {
  return {
    startByte: alias.bitOffset / byteWidth,
    byteLength: alias.width / byteWidth
  };
}

export function recordFullLocalValue(
  state: RegValueState,
  valueLocal: number,
  options: Readonly<{ mutable?: boolean }> = {}
): void {
  state.full = localBackedLaneValue(valueLocal, 0, fullWidth);
  state.partials.clear();

  for (let byteIndex = 0; byteIndex < byteCount; byteIndex += 1) {
    state.bytes[byteIndex] = localBackedLaneValue(valueLocal, byteIndex * byteWidth, fullWidth);
  }

  if (options.mutable === true) {
    state.mutableFullLocal = valueLocal;
  } else {
    delete state.mutableFullLocal;
  }
}

export function recordPartialLocalValue(state: RegValueState, alias: RegisterAlias, valueLocal: number): void {
  const { startByte, byteLength } = aliasByteRange(alias);

  state.full = unknownLaneSource;
  clearOverlappingPartialLanes(state, alias);
  state.partials.set(aliasLaneKey(alias), localBackedLaneValue(valueLocal, 0, alias.width));

  for (let index = 0; index < byteLength; index += 1) {
    state.bytes[startByte + index] = localBackedLaneValue(valueLocal, index * byteWidth, alias.width);
  }
}

export function mergePartialLocalValues(target: RegValueState, source: RegValueState): void {
  const knownByteIndexes = source.bytes
    .map((value, byteIndex) => isLocalBackedLaneValue(value) ? byteIndex : undefined)
    .filter((byteIndex): byteIndex is number => byteIndex !== undefined);

  if (knownByteIndexes.length === 0) {
    return;
  }

  target.full = unknownLaneSource;
  clearPartialLanesOverlappingBytes(target, knownByteIndexes);

  for (const byteIndex of knownByteIndexes) {
    const sourceByte = source.bytes[byteIndex];

    if (isLocalBackedLaneValue(sourceByte)) {
      target.bytes[byteIndex] = sourceByte;
    }
  }

  for (const [key, value] of source.partials) {
    target.partials.set(key, value);
  }
}

export function exactLocalSourceForAlias(
  alias: RegisterAlias,
  pending: RegValueState | undefined,
  committed: RegValueState | undefined
): LocalLaneSource | undefined {
  const pendingSource = exactLocalSourceForAliasInState(alias, pending);

  if (pendingSource !== undefined) {
    return pendingSource;
  }

  if (pending !== undefined && hasKnownBytesForAlias(pending, alias)) {
    return undefined;
  }

  return exactLocalSourceForAliasInState(alias, committed);
}

export function localValueForAlias(
  alias: RegisterAlias,
  pending: RegValueState | undefined,
  committed: RegValueState | undefined
): number | undefined {
  // Copying an existing local-backed value is only valid for exact full-register
  // writes. Narrow writes still need extraction, masking, or byte merging.
  if (alias.width !== fullWidth || alias.bitOffset !== 0) {
    return undefined;
  }

  return exactLocalSourceForAlias(alias, pending, committed)?.local;
}

export function localSourcesForAlias(
  alias: RegisterAlias,
  pending: RegValueState | undefined,
  committed: RegValueState | undefined
): readonly LocalLaneSource[] | undefined {
  const { startByte, byteLength } = aliasByteRange(alias);
  const sources: LocalLaneSource[] = [];

  for (let index = 0; index < byteLength; index += 1) {
    const source = localSourceAt(startByte + index, pending, committed);

    if (source === undefined) {
      return undefined;
    }

    sources.push(source);
  }

  return sources;
}

export function localSourceAt(
  byteIndex: number,
  pending: RegValueState | undefined,
  committed: RegValueState | undefined
): LocalLaneSource | undefined {
  const pendingByte = localSourceForLaneValue(pending?.bytes[byteIndex]);

  if (pendingByte !== undefined) {
    return pendingByte;
  }

  return localSourceForLaneValue(committed?.bytes[byteIndex]);
}

export function stateUsesLocal(state: RegValueState, local: number): boolean {
  if (exactFullLocalSource(state)?.local === local) {
    return true;
  }

  return state.bytes.some((value) => localSourceForLaneValue(value)?.local === local) ||
    [...state.partials.values()].some((value) => value.source.local === local);
}

export function knownByteLocalSources(state: RegValueState): readonly [number, LocalLaneSource][] {
  const sources: [number, LocalLaneSource][] = [];

  for (let byteIndex = 0; byteIndex < byteCount; byteIndex += 1) {
    const source = localSourceForLaneValue(state.bytes[byteIndex]);

    if (source !== undefined) {
      sources.push([byteIndex, source]);
    }
  }

  return sources;
}

export function partialLaneLocalSources(state: RegValueState): readonly PartialLaneSource[] {
  return [...state.partials.entries()]
    .map(([key, value]) => ({ ...partialLaneFromKey(key), source: value.source }))
    .sort((left, right) => left.bitOffset - right.bitOffset || right.width - left.width);
}

export function localMergeBaseForKnownBytes(state: RegValueState): number | undefined {
  const localByteSets = new Map<number, Set<number>>();

  for (const [byteIndex, source] of knownByteLocalSources(state)) {
    if (source.bitOffset !== byteIndex * byteWidth) {
      continue;
    }

    const byteSet = localByteSets.get(source.local);

    if (byteSet === undefined) {
      localByteSets.set(source.local, new Set([byteIndex]));
    } else {
      byteSet.add(byteIndex);
    }
  }

  // A merge base supplies any still-unknown high bytes. Only full-width locals
  // can safely do that; requiring ownership of byte 3 prevents a low byte/word
  // source from inventing the upper half of a register.
  return [...localByteSets.entries()]
    .filter(([, byteIndexes]) => byteIndexes.has(byteCount - 1))
    .sort((left, right) => right[1].size - left[1].size)[0]?.[0];
}

function localBackedLaneValue(local: number, bitOffset: number, valueWidth: OperandWidth): LocalBackedLaneValue {
  return {
    kind: "value",
    source: { kind: "local", local, bitOffset, valueWidth }
  };
}

function localSourceForLaneValue(value: RegisterLaneValue | undefined): LocalLaneSource | undefined {
  return isLocalBackedLaneValue(value) ? value.source : undefined;
}

function exactLocalSourceForAliasInState(
  alias: RegisterAlias,
  state: RegValueState | undefined
): LocalLaneSource | undefined {
  if (state === undefined) {
    return undefined;
  }

  if (alias.width === fullWidth && alias.bitOffset === 0) {
    return exactFullLocalSource(state);
  }

  const partial = state.partials.get(aliasLaneKey(alias));

  if (partial !== undefined) {
    return partial.source;
  }

  const full = exactFullLocalSource(state);

  return full === undefined
    ? undefined
    : { kind: "local", local: full.local, bitOffset: alias.bitOffset, valueWidth: full.valueWidth };
}

function hasKnownBytesForAlias(state: RegValueState, alias: RegisterAlias): boolean {
  const { startByte, byteLength } = aliasByteRange(alias);

  for (let index = 0; index < byteLength; index += 1) {
    if (isLocalBackedLaneValue(state.bytes[startByte + index])) {
      return true;
    }
  }

  return false;
}

function clearOverlappingPartialLanes(state: RegValueState, alias: RegisterAlias): void {
  for (const key of state.partials.keys()) {
    const lane = partialLaneFromKey(key);

    if (aliasesOverlap(alias, lane)) {
      state.partials.delete(key);
    }
  }
}

function clearPartialLanesOverlappingBytes(state: RegValueState, byteIndexes: readonly number[]): void {
  for (const key of state.partials.keys()) {
    const lane = partialLaneFromKey(key);

    if (byteIndexes.some((byteIndex) => laneOverlapsByte(lane, byteIndex))) {
      state.partials.delete(key);
    }
  }
}

function aliasLaneKey(alias: RegisterAlias): string {
  return `${alias.bitOffset}:${alias.width}`;
}

function partialLaneFromKey(key: string): LaneRange {
  const [bitOffset, width] = key.split(":").map(Number);

  if ((width !== 8 && width !== 16 && width !== 32) || (bitOffset !== 0 && bitOffset !== 8)) {
    throw new Error(`invalid register lane key: ${key}`);
  }

  return { bitOffset, width };
}

function aliasesOverlap(left: LaneRange, right: LaneRange): boolean {
  const leftEnd = left.bitOffset + left.width;
  const rightEnd = right.bitOffset + right.width;

  return left.bitOffset < rightEnd && right.bitOffset < leftEnd;
}

function laneOverlapsByte(lane: LaneRange, byteIndex: number): boolean {
  const byteBitOffset = byteIndex * byteWidth;

  return lane.bitOffset < byteBitOffset + byteWidth && byteBitOffset < lane.bitOffset + lane.width;
}
