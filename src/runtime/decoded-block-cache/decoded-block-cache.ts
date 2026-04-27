import { decodeBlock, type DecodedBlock } from "../../arch/x86/block-decoder/decode-block.js";
import type { DecodeReader } from "../../arch/x86/block-decoder/decode-reader.js";
import { u32 } from "../../core/state/cpu-state.js";

export type DecodedBlockCacheCounters = Readonly<{
  hits: number;
  misses: number;
}>;

export type DecodedBlockKey = number;

export class DecodedBlockCache {
  readonly #blocksByEip = new Map<DecodedBlockKey, DecodedBlock>();
  #hits = 0;
  #misses = 0;

  constructor(readonly decodeReader: DecodeReader) {}

  get counters(): DecodedBlockCacheCounters {
    return {
      hits: this.#hits,
      misses: this.#misses
    };
  }

  getOrDecode(startEip: number): DecodedBlock {
    const eip = u32(startEip);
    const cached = this.#blocksByEip.get(eip);

    if (cached !== undefined) {
      this.#hits += 1;
      return cached;
    }

    const decoded = decodeBlock(this.decodeReader, eip);

    this.#blocksByEip.set(eip, decoded);
    this.#misses += 1;

    return decoded;
  }
}
