import type { DecodeReader, DecodeRegion } from "../arch/x86/block-decoder/decode-reader.js";
import type { DecodeFault } from "../arch/x86/decoder/decode-error.js";
import { hostAddress, startAddress } from "./x86-code.js";

export class TestDecodeReader implements DecodeReader {
  sliceReads = 0;

  constructor(readonly regions: readonly DecodeRegion[]) {}

  regionAt(eip: number): DecodeRegion | undefined {
    for (const region of this.regions) {
      if (region.kind === "host-thunk" && region.address === eip) {
        return region;
      }

      if (region.kind === "guest-bytes") {
        const offset = eip - region.baseAddress;

        if (offset >= 0 && offset < region.bytes.length) {
          return region;
        }
      }
    }

    return undefined;
  }

  readU8(eip: number): number | DecodeFault {
    const region = this.regionAt(eip);

    if (region?.kind !== "guest-bytes") {
      return decodeFault(eip);
    }

    const offset = eip - region.baseAddress;
    const value = region.bytes[offset];

    return value ?? decodeFault(eip);
  }

  sliceFrom(eip: number, maxBytes: number): Uint8Array<ArrayBufferLike> | DecodeFault {
    this.sliceReads += 1;

    const region = this.regionAt(eip);

    if (region?.kind !== "guest-bytes") {
      return decodeFault(eip);
    }

    const offset = eip - region.baseAddress;

    return region.bytes.slice(offset, offset + maxBytes);
  }
}

export function guestBytesRegion(
  bytes: readonly number[],
  baseAddress = startAddress
): DecodeRegion {
  return {
    kind: "guest-bytes",
    baseAddress,
    bytes: Uint8Array.from(bytes)
  };
}

export function hostThunkRegion(
  hostCallId = 9,
  address = hostAddress,
  name = "test.host"
): DecodeRegion {
  return {
    kind: "host-thunk",
    address,
    name,
    hostCallId,
    convention: "stdcall"
  };
}

export function guestReader(bytes: readonly number[], baseAddress = startAddress): TestDecodeReader {
  return new TestDecodeReader([guestBytesRegion(bytes, baseAddress)]);
}

export function decodeFault(eip: number): DecodeFault {
  return {
    reason: "truncated",
    address: eip,
    offset: 0,
    raw: []
  };
}
