import { deepStrictEqual, notStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import type { DecodeReader, DecodeRegion } from "../src/arch/x86/block-decoder/decode-reader.js";
import type { DecodeFault } from "../src/arch/x86/decoder/decode-error.js";
import { DecodedBlockCache } from "../src/runtime/decoded-block-cache/decoded-block-cache.js";

const startAddress = 0x1000;
const hostAddress = 0x7000_1000;

test("same_reader_same_eip_decoded_once", () => {
  const cache = new DecodedBlockCache();
  const reader = guestReader("reader-a", [0x90, 0xc3]);

  const first = cache.getOrDecode(reader, startAddress);
  const second = cache.getOrDecode(reader, startAddress);

  strictEqual(second, first);
  deepStrictEqual(cache.counters, { hits: 1, misses: 1 });
  strictEqual(reader.sliceReads, 2);
});

test("different_eip_different_block", () => {
  const cache = new DecodedBlockCache();
  const reader = guestReader("reader-a", [0x90, 0xc3, 0x90, 0xc3]);

  const first = cache.getOrDecode(reader, startAddress);
  const second = cache.getOrDecode(reader, startAddress + 2);

  notStrictEqual(second, first);
  strictEqual(first.startEip, startAddress);
  strictEqual(second.startEip, startAddress + 2);
  deepStrictEqual(cache.counters, { hits: 0, misses: 2 });
});

test("different_reader_same_eip_different_block", () => {
  const cache = new DecodedBlockCache();
  const firstReader = guestReader("reader-a", [0x90, 0xc3]);
  const secondReader = guestReader("reader-b", [0x90, 0xc3]);

  const first = cache.getOrDecode(firstReader, startAddress);
  const second = cache.getOrDecode(secondReader, startAddress);

  notStrictEqual(second, first);
  deepStrictEqual(cache.counters, { hits: 0, misses: 2 });
});

test("unsupported_block_cached_as_terminating", () => {
  const cache = new DecodedBlockCache();
  const reader = guestReader("reader-a", [0x62]);

  const first = cache.getOrDecode(reader, startAddress);
  const second = cache.getOrDecode(reader, startAddress);

  strictEqual(second, first);
  strictEqual(first.terminator.kind, "unsupported");
  strictEqual(first.terminator.eip, startAddress);
  deepStrictEqual(cache.counters, { hits: 1, misses: 1 });
});

test("host_thunk_block_cached_without_fake_bytes", () => {
  const cache = new DecodedBlockCache();
  const reader = new CountingDecodeReader("host-reader", [
    {
      kind: "host-thunk",
      address: hostAddress,
      name: "test.host",
      hostCallId: 9,
      convention: "stdcall"
    }
  ]);

  const first = cache.getOrDecode(reader, hostAddress);
  const second = cache.getOrDecode(reader, hostAddress);

  strictEqual(second, first);
  strictEqual(first.instructions.length, 0);
  strictEqual(first.terminator.kind, "host-call");
  strictEqual(first.terminator.hostCallId, 9);
  strictEqual(reader.sliceReads, 0);
  deepStrictEqual(cache.counters, { hits: 1, misses: 1 });
});

function guestReader(identity: string, bytes: readonly number[]): CountingDecodeReader {
  return new CountingDecodeReader(identity, [
    {
      kind: "guest-bytes",
      baseAddress: startAddress,
      bytes: Uint8Array.from(bytes)
    }
  ]);
}

class CountingDecodeReader implements DecodeReader {
  sliceReads = 0;

  constructor(readonly identity: string, readonly regions: readonly DecodeRegion[]) {}

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

function decodeFault(eip: number): DecodeFault {
  return {
    reason: "truncated",
    address: eip,
    offset: 0,
    raw: []
  };
}
