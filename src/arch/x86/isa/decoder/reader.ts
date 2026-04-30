import type { GuestMemory } from "../../../../core/memory/guest-memory.js";

export const maxX86InstructionLength = 15;

export type IsaDecodeFaultReason = "truncated" | "instructionTooLong";

export type IsaDecodeFault = Readonly<{
  reason: IsaDecodeFaultReason;
  address: number;
  offset: number;
  raw: readonly number[];
}>;

export type ByteDecodeRegion = Readonly<{
  kind: "guest-bytes";
  baseAddress: number;
  bytes: Uint8Array<ArrayBufferLike>;
  generation?: number;
}>;

export type GuestMemoryDecodeRegion = Readonly<{
  kind: "guest-memory";
  baseAddress: number;
  byteLength: number;
  generation?: number;
}>;

export type DecodeRegion = ByteDecodeRegion | GuestMemoryDecodeRegion;

export type IsaDecodeReader = Readonly<{
  readU8(eip: number): number;
}>;

export type DecodeReader = IsaDecodeReader & Readonly<{
  regions?: readonly DecodeRegion[];
  regionAt(eip: number): DecodeRegion | undefined;
}>;

export class IsaDecodeError extends Error {
  constructor(readonly fault: IsaDecodeFault) {
    super(`${fault.reason} decode at 0x${fault.address.toString(16)} offset ${fault.offset}`);
    this.name = "IsaDecodeError";
  }
}

export function decodeRegionByteLength(region: DecodeRegion): number {
  return region.kind === "guest-memory" ? region.byteLength : region.bytes.length;
}

export class ByteArrayDecodeReader implements IsaDecodeReader {
  constructor(
    readonly bytes: Uint8Array<ArrayBufferLike>,
    readonly baseAddress = 0,
    readonly byteOffset = 0
  ) {}

  readU8(eip: number): number {
    const index = this.byteOffset + (eip - this.baseAddress);

    if (!Number.isInteger(index) || index < 0 || index >= this.bytes.length) {
      throw new IsaDecodeError(decodeFault(eip));
    }

    return this.bytes[index] ?? unreachableByte(eip);
  }
}

export class GuestMemoryDecodeReader implements DecodeReader {
  constructor(
    readonly memory: GuestMemory,
    readonly regions: readonly GuestMemoryDecodeRegion[]
  ) {}

  regionAt(eip: number): DecodeRegion | undefined {
    for (const region of this.regions) {
      const offset = eip - region.baseAddress;

      if (offset >= 0 && offset < region.byteLength) {
        return region;
      }
    }

    return undefined;
  }

  readU8(eip: number): number {
    if (this.regionAt(eip) === undefined) {
      throw new IsaDecodeError(decodeFault(eip));
    }

    const read = this.memory.readU8(eip);

    if (!read.ok) {
      throw new IsaDecodeError(decodeFault(eip));
    }

    return read.value;
  }
}

export function readU16LE(reader: IsaDecodeReader, eip: number): number {
  const byte0 = reader.readU8(eip);
  const byte1 = reader.readU8(eip + 1);

  return byte0 | (byte1 << 8);
}

export function readU32LE(reader: IsaDecodeReader, eip: number): number {
  const byte0 = reader.readU8(eip);
  const byte1 = reader.readU8(eip + 1);
  const byte2 = reader.readU8(eip + 2);
  const byte3 = reader.readU8(eip + 3);

  return (byte0 | (byte1 << 8) | (byte2 << 16) | (byte3 << 24)) >>> 0;
}

export function readRawBytes(reader: IsaDecodeReader, startEip: number, endEip: number): number[] {
  const raw: number[] = [];

  for (let eip = startEip; eip < endEip; eip += 1) {
    raw.push(reader.readU8(eip));
  }

  return raw;
}

export function readAvailableBytes(reader: IsaDecodeReader, startEip: number, maxBytes: number): number[] {
  const raw: number[] = [];

  for (let offset = 0; offset < maxBytes; offset += 1) {
    try {
      raw.push(reader.readU8(startEip + offset));
    } catch (error: unknown) {
      if (error instanceof IsaDecodeError) {
        return raw;
      }

      throw error;
    }
  }

  return raw;
}

export function decodeFault(address: number, raw: readonly number[] = []): IsaDecodeFault {
  return {
    reason: "truncated",
    address,
    offset: 0,
    raw
  };
}

function unreachableByte(eip: number): never {
  throw new IsaDecodeError(decodeFault(eip));
}
