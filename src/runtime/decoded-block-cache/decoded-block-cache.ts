import { decodeBlock, type DecodedBlock } from "../../arch/x86/block-decoder/decode-block.js";
import type { DecodeReader } from "../../arch/x86/block-decoder/decode-reader.js";
import { u32 } from "../../core/state/cpu-state.js";

export type DecodedBlockCacheCounters = Readonly<{
  hits: number;
  misses: number;
}>;

export class DecodedBlockCache {
  readonly #blocksByReader = new Map<string, Map<number, DecodedBlock>>();
  #hits = 0;
  #misses = 0;

  get counters(): DecodedBlockCacheCounters {
    return {
      hits: this.#hits,
      misses: this.#misses
    };
  }

  getOrDecode(decodeReader: DecodeReader, startEip: number): DecodedBlock {
    const eip = u32(startEip);
    let blocksByEip = this.#blocksByReader.get(decodeReader.identity);

    if (blocksByEip === undefined) {
      blocksByEip = new Map();
      this.#blocksByReader.set(decodeReader.identity, blocksByEip);
    }

    const cached = blocksByEip.get(eip);

    if (cached !== undefined) {
      this.#hits += 1;
      return cached;
    }

    const decoded = decodeBlock(decodeReader, eip);

    blocksByEip.set(eip, decoded);
    this.#misses += 1;

    return decoded;
  }
}
