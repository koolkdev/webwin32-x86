import { widthMask, type RegisterAlias, type Reg32 } from "#x86/isa/types.js";

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

export function existingLocalForRegisterValue(
  pending: RegValueState | undefined,
  committed: RegValueState | undefined
): number | undefined {
  // This is a pure state query: it may return an existing local, but must not
  // force a state load or compose partial bytes into a new local.
  if (pending?.fullLocal !== undefined) {
    return pending.fullLocal;
  }

  if (pending !== undefined && hasPartialBytes(pending)) {
    return undefined;
  }

  return committed?.fullLocal;
}

export function rebindableLocalForAlias(
  alias: RegisterAlias,
  pending: RegValueState | undefined,
  committed: RegValueState | undefined
): number | undefined {
  // Rebinding is only valid when the alias denotes the whole register value.
  // Narrow aliases still need extraction, masking, or byte merging.
  if (alias.width !== fullWidth || alias.bitOffset !== 0) {
    return undefined;
  }

  return existingLocalForRegisterValue(pending, committed);
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
