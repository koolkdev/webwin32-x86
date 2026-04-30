import type { GuestMemory } from "../../../../core/memory/guest-memory.js";
import {
  decodeFault,
  IsaDecodeError,
  type IsaDecodeReader
} from "../decoder/reader.js";

export type GuestMemoryDecodeRegion = Readonly<{
  kind: "guest-memory";
  baseAddress: number;
  byteLength: number;
  generation?: number;
}>;

export type RuntimeDecodeReader = IsaDecodeReader & Readonly<{
  regions: readonly GuestMemoryDecodeRegion[];
  regionAt(eip: number): GuestMemoryDecodeRegion | undefined;
}>;

export class GuestMemoryDecodeReader implements RuntimeDecodeReader {
  constructor(
    readonly memory: GuestMemory,
    readonly regions: readonly GuestMemoryDecodeRegion[]
  ) {}

  regionAt(eip: number): GuestMemoryDecodeRegion | undefined {
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
