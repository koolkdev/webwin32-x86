import type { DecodedBlock } from "../../arch/x86/block-decoder/decode-block.js";
import { cpuStateFields, u32, type CpuState } from "../../core/state/cpu-state.js";
import { stateOffset, wasmStatePtr } from "../../wasm/abi.js";
import { UnsupportedWasmCodegenError } from "../../wasm/codegen/errors.js";
import type { DecodedBlockKey } from "../decoded-block-cache/decoded-block-cache.js";
import { type WasmBlockHandle, compileWasmBlockHandle } from "./wasm-block.js";

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
      this.stateView.setUint32(wasmStatePtr + stateOffset[field], state[field], true);
    }
  }

  copyStateFromWasm(state: CpuState): void {
    for (const field of cpuStateFields) {
      state[field] = u32(this.stateView.getUint32(wasmStatePtr + stateOffset[field], true));
    }
  }
}

export class WasmBlockCache {
  readonly #blocksByKey = new Map<DecodedBlockKey, WasmBlockHandle>();
  readonly #unsupportedKeys = new Set<DecodedBlockKey>();
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
    this.#unsupportedKeys.clear();
  }

  getOrCompile(block: DecodedBlock): WasmBlockHandle | undefined {
    const blockKey = u32(block.startEip);
    const cached = this.#blocksByKey.get(blockKey);

    if (cached !== undefined) {
      this.#hits += 1;
      return cached;
    }

    if (this.#unsupportedKeys.has(blockKey)) {
      this.#hits += 1;
      this.#unsupportedCodegenFallbacks += 1;
      return undefined;
    }

    this.#misses += 1;

    try {
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
        this.#unsupportedKeys.add(blockKey);
        this.#unsupportedCodegenFallbacks += 1;
        return undefined;
      }

      throw error;
    }
  }
}
