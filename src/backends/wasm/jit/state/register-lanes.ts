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
    bytes: [...state.bytes]
  };
}

export function clearKnownBytes(state: RegValueState): void {
  state.bytes = unknownByteLanes();
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

export function recordFullStableLocal(state: RegValueState, valueLocal: number): void {
  recordAliasLaneSources(state, fullLaneAlias, stableFullLaneSources(valueLocal));
}

export function recordPartialStableLocal(state: RegValueState, alias: RegisterAlias, valueLocal: number): void {
  const sources: LocalLaneSource[] = [];

  for (let index = 0; index < alias.width / byteWidth; index += 1) {
    sources.push({
      kind: "local",
      local: valueLocal,
      bitOffset: index * byteWidth,
      valueWidth: alias.width
    });
  }

  recordAliasLaneSources(state, alias, sources);
}

export function stableFullLaneSources(valueLocal: number): FullRegisterLaneSources {
  return [
    { kind: "local", local: valueLocal, bitOffset: 0, valueWidth: fullWidth },
    { kind: "local", local: valueLocal, bitOffset: byteWidth, valueWidth: fullWidth },
    { kind: "local", local: valueLocal, bitOffset: 2 * byteWidth, valueWidth: fullWidth },
    { kind: "local", local: valueLocal, bitOffset: 3 * byteWidth, valueWidth: fullWidth }
  ];
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

export function recordAliasLaneSources(
  state: RegValueState,
  alias: RegisterAlias,
  sources: readonly LocalLaneSource[]
): void {
  const { startByte, byteLength } = aliasByteRange(alias);

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
