import { deepStrictEqual, notStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { DecodedBlockCache } from "../../src/runtime/decoded-block-cache/decoded-block-cache.js";
import { guestReader } from "../../src/test-support/decode-reader.js";
import { startAddress } from "../../src/test-support/x86-code.js";

test("same_reader_same_eip_decoded_once", () => {
  const reader = guestReader([0x90, 0xc3]);
  const cache = new DecodedBlockCache(reader);

  const first = cache.getOrDecode(startAddress);
  const second = cache.getOrDecode(startAddress);

  strictEqual(second, first);
  deepStrictEqual(cache.counters, { hits: 1, misses: 1 });
  strictEqual(reader.sliceReads, 2);
});

test("different_eip_different_block", () => {
  const reader = guestReader([0x90, 0xc3, 0x90, 0xc3]);
  const cache = new DecodedBlockCache(reader);

  const first = cache.getOrDecode(startAddress);
  const second = cache.getOrDecode(startAddress + 2);

  notStrictEqual(second, first);
  strictEqual(first.startEip, startAddress);
  strictEqual(second.startEip, startAddress + 2);
  deepStrictEqual(cache.counters, { hits: 0, misses: 2 });
});

test("different_cache_same_eip_different_block", () => {
  const firstCache = new DecodedBlockCache(guestReader([0x90, 0xc3]));
  const secondCache = new DecodedBlockCache(guestReader([0x90, 0xc3]));

  const first = firstCache.getOrDecode(startAddress);
  const second = secondCache.getOrDecode(startAddress);

  notStrictEqual(second, first);
  deepStrictEqual(firstCache.counters, { hits: 0, misses: 1 });
  deepStrictEqual(secondCache.counters, { hits: 0, misses: 1 });
});

test("unsupported_block_cached_as_terminating", () => {
  const reader = guestReader([0x62]);
  const cache = new DecodedBlockCache(reader);

  const first = cache.getOrDecode(startAddress);
  const second = cache.getOrDecode(startAddress);

  strictEqual(second, first);
  strictEqual(first.terminator.kind, "unsupported");
  strictEqual(first.terminator.eip, startAddress);
  deepStrictEqual(cache.counters, { hits: 1, misses: 1 });
});
