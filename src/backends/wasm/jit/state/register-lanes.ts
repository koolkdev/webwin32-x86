import type { RegisterAlias, Reg32 } from "#x86/isa/types.js";
import { widthMask } from "#x86/state/cpu-state.js";

export type ByteSource = Readonly<{
  local: number;
  bitOffset: number;
}>;

export type RegValueState = {
  fullLocal?: number;
  bytes: (ByteSource | undefined)[];
};

export type AliasByteRange = Readonly<{
  startByte: number;
  byteLength: number;
}>;

export const fullWidth = 32;
export const byteWidth = 8;
export const byteMask = 0xff;
export const byteCount = 4;

export function emptyRegValueState(): RegValueState {
  return {
    bytes: new Array<ByteSource | undefined>(byteCount).fill(undefined)
  };
}

export function clearPartialBytes(state: RegValueState): void {
  state.bytes.fill(undefined);
}

export function hasPartialBytes(state: RegValueState): boolean {
  return state.bytes.some((source) => source !== undefined);
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

export function recordPartialValue(state: RegValueState, alias: RegisterAlias, valueLocal: number): void {
  const { startByte, byteLength } = aliasByteRange(alias);

  for (let index = 0; index < byteLength; index += 1) {
    state.bytes[startByte + index] = {
      local: valueLocal,
      bitOffset: index * byteWidth
    };
  }
}

export function directFullLocalForRead(
  alias: RegisterAlias,
  pending: RegValueState | undefined,
  committed: RegValueState | undefined
): number | undefined {
  if (pending?.fullLocal !== undefined) {
    return pending.fullLocal;
  }

  if (pending !== undefined && hasPartialBytes(pending)) {
    return undefined;
  }

  return committed?.fullLocal;
}

export function byteSourcesForAlias(
  alias: RegisterAlias,
  pending: RegValueState | undefined,
  committed: RegValueState | undefined
): readonly ByteSource[] | undefined {
  const { startByte, byteLength } = aliasByteRange(alias);
  const sources: ByteSource[] = [];

  for (let index = 0; index < byteLength; index += 1) {
    const source = byteSourceAt(startByte + index, pending, committed);

    if (source === undefined) {
      return undefined;
    }

    sources.push(source);
  }

  return sources;
}

export function byteSourceAt(
  byteIndex: number,
  pending: RegValueState | undefined,
  committed: RegValueState | undefined
): ByteSource | undefined {
  if (pending?.fullLocal !== undefined) {
    return { local: pending.fullLocal, bitOffset: byteIndex * byteWidth };
  }

  const pendingByte = pending?.bytes[byteIndex];

  if (pendingByte !== undefined) {
    return pendingByte;
  }

  if (committed?.fullLocal !== undefined) {
    return { local: committed.fullLocal, bitOffset: byteIndex * byteWidth };
  }

  return committed?.bytes[byteIndex];
}
