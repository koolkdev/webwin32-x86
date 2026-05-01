import { decodeIsaBlock, type IsaDecodedBlock } from "../../arch/x86/isa/decoder/decode-block.js";
import type { IsaDecodeFault } from "../../arch/x86/isa/decoder/reader.js";
import { u32 } from "../../core/state/cpu-state.js";
import type { RuntimeWasmBlockCacheMetrics } from "../../metrics/runtime-adapter.js";
import { UnsupportedWasmCodegenError } from "../../wasm/errors.js";
import type { RuntimeCodeMap } from "../program/code-map.js";
import { compileWasmBlockHandle } from "../wasm-block/wasm-block.js";
import type { RuntimeWasmMemories } from "../wasm/memories.js";
import type { CompiledBlockCache, CompiledBlockHandle } from "./block-cache.js";

export type RuntimeCompiledBlockCache = CompiledBlockCache & Partial<Readonly<{
  metrics: RuntimeWasmBlockCacheMetrics;
  clear(): void;
}>>;

export class CompiledBlockDecodeError extends Error {
  constructor(readonly fault: IsaDecodeFault) {
    super(`failed to decode compiled block at 0x${fault.address.toString(16)}`);
    this.name = "CompiledBlockDecodeError";
  }
}

export class WasmCompiledBlockCache implements RuntimeCompiledBlockCache {
  readonly #blocksByEip = new Map<number, CompiledBlockHandle>();
  #hits = 0;
  #misses = 0;
  #inserts = 0;
  #unsupportedCodegenFallbacks = 0;

  get metrics(): RuntimeWasmBlockCacheMetrics {
    return {
      hits: this.#hits,
      misses: this.#misses,
      inserts: this.#inserts,
      unsupportedCodegenFallbacks: this.#unsupportedCodegenFallbacks
    };
  }

  clear(): void {
    this.#blocksByEip.clear();
  }

  getOrCompile(startEip: number, codeMap: RuntimeCodeMap, memories: RuntimeWasmMemories): CompiledBlockHandle | undefined {
    const blockKey = u32(startEip);
    const cached = this.#blocksByEip.get(blockKey);

    if (cached !== undefined) {
      this.#hits += 1;
      return cached;
    }

    this.#misses += 1;

    try {
      const block = decodeIsaBlock(codeMap.createReader(memories.guest), blockKey, { maxInstructions: 1024 });

      assertCompiledBlockDecodable(block);

      if (block.instructions.length === 0) {
        this.#unsupportedCodegenFallbacks += 1;
        return undefined;
      }

      const compiled = compileWasmBlockHandle(block, {
        stateMemory: memories.stateMemory,
        guestMemory: memories.guestMemory,
        blockKey
      });

      this.#blocksByEip.set(blockKey, compiled);
      this.#inserts += 1;
      return compiled;
    } catch (error: unknown) {
      if (error instanceof UnsupportedWasmCodegenError) {
        this.#unsupportedCodegenFallbacks += 1;
        return undefined;
      }

      throw error;
    }
  }
}

function assertCompiledBlockDecodable(block: IsaDecodedBlock): void {
  if (block.terminator.kind === "decode-fault") {
    throw new CompiledBlockDecodeError(block.terminator.fault);
  }
}
