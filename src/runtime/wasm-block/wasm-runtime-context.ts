import { decodeIsaBlock, type IsaBlockDecodeReader } from "../../arch/x86/isa/decoder/decode-block.js";
import { cpuStateFields, u32, type CpuState } from "../../core/state/cpu-state.js";
import { stateOffset } from "../../wasm/abi.js";
import { UnsupportedWasmCodegenError } from "../../wasm/codegen/errors.js";
import { type WasmBlockHandle, type WasmBlockKey, compileWasmBlockHandle } from "./wasm-block.js";

export type WasmBlockCacheCounters = Readonly<{
  hits: number;
  misses: number;
  inserts: number;
  unsupportedCodegenFallbacks: number;
}>;

export const emptyWasmBlockCacheCounters: WasmBlockCacheCounters = {
  hits: 0,
  misses: 0,
  inserts: 0,
  unsupportedCodegenFallbacks: 0
};

const wasmStateMemoryPages = 1;

export class WasmRuntimeContext {
  readonly stateMemory = new WebAssembly.Memory({ initial: wasmStateMemoryPages });
  readonly stateView = new DataView(this.stateMemory.buffer);
  readonly blockCache: WasmBlockCache;

  constructor(readonly guestMemory: WebAssembly.Memory) {
    this.blockCache = new WasmBlockCache(this.stateMemory, this.guestMemory);
  }

  copyStateToWasm(state: CpuState): void {
    for (const field of cpuStateFields) {
      this.stateView.setUint32(stateOffset[field], state[field], true);
    }
  }

  copyStateFromWasm(state: CpuState): void {
    for (const field of cpuStateFields) {
      state[field] = u32(this.stateView.getUint32(stateOffset[field], true));
    }
  }
}

export class WasmBlockCache {
  readonly #blocksByKey = new Map<WasmBlockKey, WasmBlockHandle>();
  #hits = 0;
  #misses = 0;
  #inserts = 0;
  #unsupportedCodegenFallbacks = 0;

  constructor(
    readonly stateMemory: WebAssembly.Memory,
    readonly guestMemory: WebAssembly.Memory
  ) {}

  get counters(): WasmBlockCacheCounters {
    return {
      hits: this.#hits,
      misses: this.#misses,
      inserts: this.#inserts,
      unsupportedCodegenFallbacks: this.#unsupportedCodegenFallbacks
    };
  }

  clear(): void {
    this.#blocksByKey.clear();
  }

  getOrCompile(startEip: number, reader: IsaBlockDecodeReader): WasmBlockHandle | undefined {
    const blockKey = u32(startEip);
    const cached = this.#blocksByKey.get(blockKey);

    if (cached !== undefined) {
      this.#hits += 1;
      return cached;
    }

    this.#misses += 1;

    try {
      const block = decodeIsaBlock(reader, blockKey);

      if (block.instructions.length === 0) {
        this.#unsupportedCodegenFallbacks += 1;
        return undefined;
      }

      const compiled = compileWasmBlockHandle(block, {
        stateMemory: this.stateMemory,
        guestMemory: this.guestMemory,
        blockKey
      });

      this.#blocksByKey.set(blockKey, compiled);
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
