import type { GuestMemory } from "../../../core/memory/guest-memory.js";
import type { DecodeFault } from "../decoder/decode-error.js";
import {
  decodeRegionByteLength,
  type DecodeReader,
  type DecodeRegion
} from "./decode-reader.js";

export type GuestMemoryDecodeRegion = Readonly<{
  kind: "guest-memory";
  baseAddress: number;
  byteLength: number;
  generation?: number;
}>;

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

  readU8(eip: number): number | DecodeFault {
    if (this.regionAt(eip) === undefined) {
      return decodeFault(eip);
    }

    const read = this.memory.readU8(eip);

    return read.ok ? read.value : decodeFault(eip);
  }

  sliceFrom(eip: number, maxBytes: number): Uint8Array<ArrayBufferLike> | DecodeFault {
    const region = this.regionAt(eip);

    if (region === undefined) {
      return decodeFault(eip);
    }

    const byteLength = Math.min(maxBytes, decodeRegionByteLength(region) - (eip - region.baseAddress));
    const bytes = new Uint8Array(byteLength);

    for (let index = 0; index < byteLength; index += 1) {
      const read = this.memory.readU8(eip + index);

      if (!read.ok) {
        return decodeFault(eip, Array.from(bytes.slice(0, index)));
      }

      bytes[index] = read.value;
    }

    return bytes;
  }
}

function decodeFault(address: number, raw: readonly number[] = []): DecodeFault {
  return {
    reason: "truncated",
    address,
    offset: 0,
    raw
  };
}
