import type { DecodeReader } from "../../arch/x86/block-decoder/decode-reader.js";
import type { RunResult } from "../../core/execution/run-result.js";
import { ArrayBufferGuestMemory, type GuestMemory } from "../../core/memory/guest-memory.js";
import { createCpuState, u32, type CpuState } from "../../core/state/cpu-state.js";
import { DecodedBlockCache, type DecodedBlockCacheCounters } from "../decoded-block-cache/decoded-block-cache.js";
import { DecodedBlockRunner, type ProfileCounters } from "../decoded-block-runner/decoded-block-runner.js";
import { runT0InstructionInterpreter } from "../tiering/executors/t0-instruction-interpreter.js";
import { runT1DecodedBlocks } from "../tiering/executors/t1-decoded-blocks.js";
import { runT2WasmBlocks } from "../tiering/executors/t2-wasm-blocks.js";
import type { RuntimeTierExecutionContext } from "../tiering/executors/context.js";
import { defaultTierMode, TierMode } from "../tiering/tier-policy.js";
import {
  emptyWasmBlockCacheCounters,
  WasmRuntimeContext,
  type WasmBlockCacheCounters
} from "../wasm-block/wasm-runtime-context.js";

export type RuntimeInstanceOptions = Readonly<{
  decodeReader: DecodeReader;
  initialState?: Partial<CpuState>;
  guestMemory?: GuestMemory;
  guestMemoryByteLength?: number;
  tierMode?: TierMode;
}>;

export type RuntimeInstanceRunOptions = Readonly<{
  entryEip?: number;
  instructionLimit?: number;
}>;

export type RuntimeInstanceCounters = Readonly<{
  decodedBlockCache: DecodedBlockCacheCounters;
  profile: ProfileCounters;
  wasmBlockCache: WasmBlockCacheCounters;
}>;

type RuntimeTierExecutor = (instructionLimit: number) => RunResult;
type RuntimeGuestMemoryResources = Readonly<{
  guestMemory: GuestMemory;
  wasmGuestMemory?: WebAssembly.Memory;
}>;

const defaultGuestMemoryByteLength = 1024 * 1024;
const defaultInstructionLimit = 10_000;
const wasmPageByteLength = 0x1_0000;

export class RuntimeInstance {
  readonly state: CpuState;
  readonly guestMemory: GuestMemory;
  readonly decodeReader: DecodeReader;
  readonly decodedBlockCache: DecodedBlockCache;
  readonly #decodedBlockRunner: DecodedBlockRunner;
  readonly #tierExecutors: Readonly<Record<TierMode, RuntimeTierExecutor>>;
  readonly #wasmRuntime: WasmRuntimeContext | undefined;
  readonly #tierMode: TierMode;

  constructor(options: RuntimeInstanceOptions) {
    this.state = createCpuState(options.initialState ?? {});
    this.#tierMode = options.tierMode ?? defaultTierMode;
    const guestMemoryResources = createGuestMemoryResources(options, this.#tierMode);

    this.guestMemory = guestMemoryResources.guestMemory;
    this.#wasmRuntime = guestMemoryResources.wasmGuestMemory === undefined
      ? undefined
      : new WasmRuntimeContext(guestMemoryResources.wasmGuestMemory);
    this.decodeReader = options.decodeReader;
    this.decodedBlockCache = new DecodedBlockCache(this.decodeReader);
    this.#decodedBlockRunner = new DecodedBlockRunner(this.decodedBlockCache);
    this.#tierExecutors = {
      [TierMode.T0_ONLY]: (instructionLimit) => runT0InstructionInterpreter(this.#executionContext(), instructionLimit),
      [TierMode.T1_ONLY]: (instructionLimit) => runT1DecodedBlocks(this.#executionContext(), instructionLimit),
      [TierMode.T2_ONLY]: (instructionLimit) =>
        runT2WasmBlocks(this.#executionContext(), instructionLimit)
    };
  }

  get tierMode(): TierMode {
    return this.#tierMode;
  }

  get counters(): RuntimeInstanceCounters {
    return {
      decodedBlockCache: this.decodedBlockCache.counters,
      profile: this.#decodedBlockRunner.counters,
      wasmBlockCache: this.#wasmRuntime?.blockCache.counters ?? emptyWasmBlockCacheCounters
    };
  }

  clearWasmBlockCache(): void {
    this.#wasmRuntime?.blockCache.clear();
  }

  run(options: RuntimeInstanceRunOptions = {}): RunResult {
    if (options.entryEip !== undefined) {
      this.state.eip = u32(options.entryEip);
    }

    const instructionLimit = options.instructionLimit ?? defaultInstructionLimit;

    return this.#tierExecutors[this.#tierMode](instructionLimit);
  }

  #executionContext(): RuntimeTierExecutionContext {
    const context = {
      state: this.state,
      guestMemory: this.guestMemory,
      decodeReader: this.decodeReader,
      decodedBlockCache: this.decodedBlockCache,
      decodedBlockRunner: this.#decodedBlockRunner
    };

    return this.#wasmRuntime === undefined
      ? context
      : { ...context, wasmRuntime: this.#wasmRuntime };
  }
}

function createGuestMemoryResources(options: RuntimeInstanceOptions, tierMode: TierMode): RuntimeGuestMemoryResources {
  if (options.guestMemory !== undefined) {
    if (tierMode === TierMode.T2_ONLY) {
      throw new Error("T2 runtime requires runtime-owned WebAssembly guest memory");
    }

    return { guestMemory: options.guestMemory };
  }

  const byteLength = options.guestMemoryByteLength ?? defaultGuestMemoryByteLength;

  if (tierMode === TierMode.T2_ONLY && byteLength <= 0) {
    throw new RangeError("T2 guestMemoryByteLength must be positive");
  }

  if (tierMode === TierMode.T2_ONLY) {
    const wasmGuestMemory = new WebAssembly.Memory({ initial: wasmPagesForByteLength(byteLength) });

    return {
      guestMemory: new ArrayBufferGuestMemory(wasmGuestMemory.buffer),
      wasmGuestMemory
    };
  }

  return { guestMemory: new ArrayBufferGuestMemory(byteLength) };
}

function wasmPagesForByteLength(byteLength: number): number {
  return Math.ceil(byteLength / wasmPageByteLength);
}
