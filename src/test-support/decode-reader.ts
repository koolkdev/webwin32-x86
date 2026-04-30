import {
  decodeFault,
  decodeRegionByteLength,
  IsaDecodeError,
  type ByteDecodeRegion,
  type DecodeReader,
  type DecodeRegion
} from "../arch/x86/isa/decoder/reader.js";
import { startAddress } from "./x86-code.js";

export class TestDecodeReader implements DecodeReader {
  constructor(readonly regions: readonly DecodeRegion[]) {}

  regionAt(eip: number): DecodeRegion | undefined {
    for (const region of this.regions) {
      const offset = eip - region.baseAddress;

      if (offset >= 0 && offset < decodeRegionByteLength(region)) {
        return region;
      }
    }

    return undefined;
  }

  readU8(eip: number): number {
    const region = this.regionAt(eip);

    if (region?.kind !== "guest-bytes") {
      throw new IsaDecodeError(decodeFault(eip));
    }

    const offset = eip - region.baseAddress;
    const value = region.bytes[offset];

    if (value === undefined) {
      throw new IsaDecodeError(decodeFault(eip));
    }

    return value;
  }
}

export function guestBytesRegion(
  bytes: readonly number[],
  baseAddress = startAddress
): ByteDecodeRegion {
  return {
    kind: "guest-bytes",
    baseAddress,
    bytes: Uint8Array.from(bytes)
  };
}

export function guestReader(bytes: readonly number[], baseAddress = startAddress): TestDecodeReader {
  return new TestDecodeReader([guestBytesRegion(bytes, baseAddress)]);
}
