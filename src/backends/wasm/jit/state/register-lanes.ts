import { widthMask, type OperandWidth, type RegisterAlias, type Reg32 } from "#x86/isa/types.js";

export type UnknownLaneSource = Readonly<{
  kind: "unknown";
}>;

export type LocalLaneSourceOwner = Readonly<{
  retain(): LocalLaneSourceOwner;
  release(): void;
}>;

export type LocalLaneSource = Readonly<{
  kind: "local";
  local: number;
  bitOffset: number;
  valueWidth: OperandWidth;
  owner?: LocalLaneSourceOwner | undefined;
}>;

export type FullRegisterLaneSources = readonly [
  LocalLaneSource,
  LocalLaneSource,
  LocalLaneSource,
  LocalLaneSource
];

export type LocalBackedByteLane = Readonly<{
  kind: "value";
  source: LocalLaneSource;
}>;

export type ByteLane = UnknownLaneSource | LocalBackedByteLane;

export type RegValueState = {
  bytes: [ByteLane, ByteLane, ByteLane, ByteLane];
};

export type AliasByteRange = Readonly<{
  startByte: number;
  byteLength: number;
}>;

export const fullWidth = 32;
export const byteWidth = 8;
export const byteMask = 0xff;
export const byteCount = 4;

const unknownLaneSource: UnknownLaneSource = { kind: "unknown" };
const fullLaneAlias: RegisterAlias = { name: "eax", base: "eax", bitOffset: 0, width: fullWidth };

export function emptyRegValueState(): RegValueState {
  return {
    bytes: unknownByteLanes()
  };
}

export function cloneRegValueState(state: RegValueState): RegValueState {
  return {
    bytes: state.bytes.map(clonePinnedByteLane) as [ByteLane, ByteLane, ByteLane, ByteLane]
  };
}

export function clearKnownBytes(state: RegValueState): void {
  const previous = [...state.bytes] as [ByteLane, ByteLane, ByteLane, ByteLane];

  state.bytes = unknownByteLanes();
  releaseRemovedLaneOwners(previous, state);
}

export function moveRegValueStateBytes(
  state: RegValueState,
  bytes: [ByteLane, ByteLane, ByteLane, ByteLane]
): void {
  const previous = [...state.bytes] as [ByteLane, ByteLane, ByteLane, ByteLane];

  state.bytes = bytes;
  releaseRemovedLaneOwners(previous, state);
}

export function isLocalBackedByteLane(value: ByteLane | undefined): value is LocalBackedByteLane {
  return value?.kind === "value" && value.source.kind === "local";
}

export function hasKnownBytes(state: RegValueState): boolean {
  return state.bytes.some(isLocalBackedByteLane);
}

export function allBytesKnown(state: RegValueState): boolean {
  return state.bytes.every(isLocalBackedByteLane);
}

export function exactFullLocal(state: RegValueState | undefined): LocalLaneSource | undefined {
  return exactLocalForAlias(state, fullLaneAlias);
}

export function fullRegAccess(reg: Reg32): RegisterAlias {
  return { name: reg, base: reg, bitOffset: 0, width: fullWidth };
}

export function aliasByteRange(alias: RegisterAlias): AliasByteRange {
  return {
    startByte: alias.bitOffset / byteWidth,
    byteLength: alias.width / byteWidth
  };
}

export function aliasMask(alias: RegisterAlias): number {
  return (widthMask(alias.width) << alias.bitOffset) >>> 0;
}

export function recordFullStableLocal(
  state: RegValueState,
  valueLocal: number
): void {
  recordOwnedAliasLaneSources(state, fullLaneAlias, stableFullLaneSources(valueLocal));
}

export function recordPartialStableLocal(
  state: RegValueState,
  alias: RegisterAlias,
  valueLocal: number
): void {
  const sources: LocalLaneSource[] = [];

  for (let index = 0; index < alias.width / byteWidth; index += 1) {
    sources.push(localLaneSource(valueLocal, index * byteWidth, alias.width));
  }

  recordOwnedAliasLaneSources(state, alias, sources);
}

export function stableFullLaneSources(valueLocal: number): FullRegisterLaneSources {
  return [
    localLaneSource(valueLocal, 0, fullWidth),
    localLaneSource(valueLocal, byteWidth, fullWidth),
    localLaneSource(valueLocal, 2 * byteWidth, fullWidth),
    localLaneSource(valueLocal, 3 * byteWidth, fullWidth)
  ];
}

export function ownedStableFullLaneSources(
  valueLocal: number,
  owner: LocalLaneSourceOwner
): FullRegisterLaneSources {
  return [
    localLaneSource(valueLocal, 0, fullWidth, ownerForLane(owner, 0)),
    localLaneSource(valueLocal, byteWidth, fullWidth, ownerForLane(owner, 1)),
    localLaneSource(valueLocal, 2 * byteWidth, fullWidth, ownerForLane(owner, 2)),
    localLaneSource(valueLocal, 3 * byteWidth, fullWidth, ownerForLane(owner, 3))
  ];
}

export function retainFullRegisterLaneSources(
  sources: FullRegisterLaneSources
): FullRegisterLaneSources {
  return sources.map(retainLaneSource) as unknown as FullRegisterLaneSources;
}

export function fullRegisterLaneSourcesFrom(
  sources: readonly LocalLaneSource[] | undefined
): FullRegisterLaneSources | undefined {
  if (sources === undefined) {
    return undefined;
  }

  assertFullRegisterLaneSources(sources);
  return sources;
}

export function recordOwnedAliasLaneSources(
  state: RegValueState,
  alias: RegisterAlias,
  sources: readonly LocalLaneSource[]
): void {
  const { startByte, byteLength } = aliasByteRange(alias);
  const previous = [...state.bytes] as [ByteLane, ByteLane, ByteLane, ByteLane];

  if (sources.length !== byteLength) {
    throw new Error(`register alias lane write needs ${byteLength} byte sources, got ${sources.length}`);
  }

  for (let index = 0; index < byteLength; index += 1) {
    const source = sources[index];

    if (source === undefined) {
      throw new Error(`missing register alias lane source: ${index}`);
    }

    assertLaneSourceCanSupplyByte(source);
    state.bytes[startByte + index] = { kind: "value", source };
  }

  releaseRemovedLaneOwners(previous, state);
}

export function recordOwnedByteLaneSource(
  state: RegValueState,
  byteIndex: number,
  source: LocalLaneSource
): void {
  const previous = [...state.bytes] as [ByteLane, ByteLane, ByteLane, ByteLane];

  assertLaneSourceCanSupplyByte(source);
  state.bytes[byteIndex] = { kind: "value", source };
  releaseRemovedLaneOwners(previous, state);
}

export function assertFullRegisterLaneSources(
  sources: readonly LocalLaneSource[]
): asserts sources is FullRegisterLaneSources {
  if (sources.length !== byteCount) {
    throw new Error(`full register lane copy needs ${byteCount} byte sources, got ${sources.length}`);
  }

  for (let byteIndex = 0; byteIndex < byteCount; byteIndex += 1) {
    const source = sources[byteIndex];

    if (source === undefined) {
      throw new Error(`missing full register lane source: ${byteIndex}`);
    }

    assertLaneSourceCanSupplyByte(source);
  }
}

export function laneSourcesForAlias(
  state: RegValueState | undefined,
  alias: RegisterAlias
): readonly LocalLaneSource[] | undefined {
  if (state === undefined) {
    return undefined;
  }

  const { startByte, byteLength } = aliasByteRange(alias);
  const sources: LocalLaneSource[] = [];

  for (let index = 0; index < byteLength; index += 1) {
    const source = localSourceForByteLane(state.bytes[startByte + index]);

    if (source === undefined) {
      return undefined;
    }

    sources.push(source);
  }

  return sources;
}

export function exactLocalForAlias(
  state: RegValueState | undefined,
  alias: RegisterAlias
): LocalLaneSource | undefined {
  return exactLocalForLaneSources(laneSourcesForAlias(state, alias), alias.width);
}

export function exactLocalForLaneSources(
  sources: readonly LocalLaneSource[] | undefined,
  width: OperandWidth
): LocalLaneSource | undefined {
  const first = sources?.[0];

  if (sources === undefined || first === undefined) {
    return undefined;
  }

  const byteLength = width / byteWidth;

  if (sources.length !== byteLength || first.bitOffset + width > first.valueWidth) {
    return undefined;
  }

  for (let index = 0; index < byteLength; index += 1) {
    const source = sources[index];

    if (
      source === undefined ||
      source.local !== first.local ||
      source.valueWidth !== first.valueWidth ||
      source.bitOffset !== first.bitOffset + index * byteWidth
    ) {
      return undefined;
    }
  }

  return {
    kind: "local",
    local: first.local,
    bitOffset: first.bitOffset,
    valueWidth: first.valueWidth
  };
}

export function localSourceAt(state: RegValueState | undefined, byteIndex: number): LocalLaneSource | undefined {
  return localSourceForByteLane(state?.bytes[byteIndex]);
}

export function knownByteLocalSources(state: RegValueState): readonly [number, LocalLaneSource][] {
  const sources: [number, LocalLaneSource][] = [];

  for (let byteIndex = 0; byteIndex < byteCount; byteIndex += 1) {
    const source = localSourceForByteLane(state.bytes[byteIndex]);

    if (source !== undefined) {
      sources.push([byteIndex, source]);
    }
  }

  return sources;
}

function unknownByteLanes(): [ByteLane, ByteLane, ByteLane, ByteLane] {
  return [unknownLaneSource, unknownLaneSource, unknownLaneSource, unknownLaneSource];
}

function localLaneSource(
  local: number,
  bitOffset: number,
  valueWidth: OperandWidth,
  owner?: LocalLaneSourceOwner | undefined
): LocalLaneSource {
  return owner === undefined
    ? { kind: "local", local, bitOffset, valueWidth }
    : { kind: "local", local, bitOffset, valueWidth, owner };
}

function ownerForLane(
  owner: LocalLaneSourceOwner | undefined,
  index: number
): LocalLaneSourceOwner | undefined {
  if (owner === undefined) {
    return undefined;
  }

  return index === 0 ? owner : owner.retain();
}

function retainLaneSource(source: LocalLaneSource): LocalLaneSource {
  return localLaneSource(source.local, source.bitOffset, source.valueWidth, source.owner?.retain());
}

function clonePinnedByteLane(lane: ByteLane): ByteLane {
  if (!isLocalBackedByteLane(lane)) {
    return lane;
  }

  return {
    kind: "value",
    source: retainLaneSource(lane.source)
  };
}

function releaseRemovedLaneOwners(
  previous: readonly ByteLane[],
  state: RegValueState
): void {
  const retainedOwners = new Set<LocalLaneSourceOwner>();

  for (const lane of state.bytes) {
    const owner = localSourceForByteLane(lane)?.owner;

    if (owner !== undefined) {
      retainedOwners.add(owner);
    }
  }

  const releasedOwners = new Set<LocalLaneSourceOwner>();

  for (const lane of previous) {
    const owner = localSourceForByteLane(lane)?.owner;

    if (owner !== undefined && !retainedOwners.has(owner) && !releasedOwners.has(owner)) {
      releasedOwners.add(owner);
      owner.release();
    }
  }
}

function assertLaneSourceCanSupplyByte(source: LocalLaneSource): void {
  if (source.bitOffset % byteWidth !== 0 || source.bitOffset < 0) {
    throw new Error(`invalid register lane bit offset: ${source.bitOffset}`);
  }

  if (source.bitOffset + byteWidth > source.valueWidth) {
    throw new Error(`register lane source cannot supply byte at bit offset ${source.bitOffset}`);
  }
}

function localSourceForByteLane(value: ByteLane | undefined): LocalLaneSource | undefined {
  return isLocalBackedByteLane(value) ? value.source : undefined;
}
