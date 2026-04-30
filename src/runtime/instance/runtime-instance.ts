import { GuestMemoryDecodeReader } from "../../arch/x86/block-decoder/guest-memory-decode-reader.js";
import type { DecodeReader } from "../../arch/x86/block-decoder/decode-reader.js";
import type { RunResult } from "../../core/execution/run-result.js";
import { ArrayBufferGuestMemory, type GuestMemory } from "../../core/memory/guest-memory.js";
import { createCpuState, u32, type CpuState } from "../../core/state/cpu-state.js";
import type { MetricSink } from "../../metrics/collector.js";
import { recordRuntimeMetrics, type RuntimeMetrics } from "../../metrics/runtime-adapter.js";
import {
  loadProgramRegions,
  normalizeProgramRegions,
  programDecodeRegions,
  requiredProgramByteLength,
  type RuntimeProgramInput,
  type RuntimeProgramRegion
} from "./program-loader.js";
import { runT0InstructionInterpreter } from "../tiering/executors/t0-instruction-interpreter.js";
import { runT1WasmInterpreter } from "../tiering/executors/t1-wasm-interpreter.js";
import { runT2WasmBlocks } from "../tiering/executors/t2-wasm-blocks.js";
import type { RuntimeTierExecutionContext } from "../tiering/executors/context.js";
import { defaultTierMode, TierMode } from "../tiering/tier-policy.js";
import {
  emptyWasmBlockCacheCounters,
  WasmRuntimeContext,
  type WasmBlockCacheCounters
} from "../wasm-block/wasm-runtime-context.js";
import { WasmInterpreterRuntime } from "../../wasm/interpreter/runtime.js";

export type RuntimeInstanceOptions = Readonly<{
  program?: RuntimeProgramInput;
  initialState?: Partial<CpuState>;
  guestMemory?: GuestMemory;
  guestMemoryByteLength?: number;
  tierMode?: TierMode;
  t2MaxInstructionsPerBlock?: number;
}>;

export type RuntimeInstanceRunOptions = Readonly<{
  entryEip?: number;
  instructionLimit?: number;
  metrics?: MetricSink;
}>;

export type RuntimeInstanceCounters = Readonly<{
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
  readonly #tierExecutors: Readonly<Record<TierMode, RuntimeTierExecutor>>;
  readonly #wasmInterpreterRuntime: WasmInterpreterRuntime | undefined;
  readonly #wasmRuntime: WasmRuntimeContext | undefined;
  readonly #tierMode: TierMode;

  constructor(options: RuntimeInstanceOptions) {
    this.state = createCpuState(options.initialState ?? {});
    this.#tierMode = options.tierMode ?? defaultTierMode;
    const program = normalizeProgramRegions(options.program);
    const guestMemoryResources = createGuestMemoryResources(options, this.#tierMode, program);

    this.guestMemory = guestMemoryResources.guestMemory;
    loadProgramBytesToGuestMemory(program, this.guestMemory);
    this.decodeReader = new GuestMemoryDecodeReader(this.guestMemory, programDecodeRegions(program));
    this.#wasmInterpreterRuntime = this.#tierMode === TierMode.T1_ONLY || this.#tierMode === TierMode.T2_ONLY
      ? requiredWasmGuestMemory(guestMemoryResources, "T1")
      : undefined;
    this.#wasmRuntime = this.#tierMode !== TierMode.T2_ONLY || guestMemoryResources.wasmGuestMemory === undefined
      ? undefined
      : new WasmRuntimeContext(guestMemoryResources.wasmGuestMemory, {
          ...(options.t2MaxInstructionsPerBlock === undefined
            ? {}
            : { maxInstructionsPerBlock: options.t2MaxInstructionsPerBlock })
        });
    this.#tierExecutors = {
      [TierMode.T0_ONLY]: (instructionLimit) => runT0InstructionInterpreter(this.#executionContext(), instructionLimit),
      [TierMode.T1_ONLY]: (instructionLimit) => runT1WasmInterpreter(this.#executionContext(), instructionLimit),
      [TierMode.T2_ONLY]: (instructionLimit) =>
        runT2WasmBlocks(this.#executionContext(), instructionLimit)
    };
  }

  get tierMode(): TierMode {
    return this.#tierMode;
  }

  get counters(): RuntimeInstanceCounters {
    return {
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

    const result = this.#tierExecutors[this.#tierMode](instructionLimit);

    if (options.metrics !== undefined) {
      recordRuntimeMetrics(options.metrics, this.#runtimeMetrics(result));
    }

    return result;
  }

  #executionContext(): RuntimeTierExecutionContext {
    const context = {
      state: this.state,
      guestMemory: this.guestMemory,
      decodeReader: this.decodeReader
    };

    return {
      ...context,
      ...(this.#wasmInterpreterRuntime === undefined ? {} : { wasmInterpreterRuntime: this.#wasmInterpreterRuntime }),
      ...(this.#wasmRuntime === undefined ? {} : { wasmRuntime: this.#wasmRuntime })
    };
  }

  #runtimeMetrics(result: RunResult): RuntimeMetrics {
    const counters = this.counters;

    return {
      guestInstructions: result.instructionCount,
      finalEip: this.state.eip,
      stopReason: result.stopReason,
      wasmBlockCache: counters.wasmBlockCache
    };
  }
}

function createGuestMemoryResources(
  options: RuntimeInstanceOptions,
  tierMode: TierMode,
  program: readonly RuntimeProgramRegion[]
): RuntimeGuestMemoryResources {
  if (options.guestMemory !== undefined) {
    if (tierMode === TierMode.T1_ONLY || tierMode === TierMode.T2_ONLY) {
      throw new Error(`${tierModeName(tierMode)} runtime requires runtime-owned WebAssembly guest memory`);
    }

    return { guestMemory: options.guestMemory };
  }

  const byteLength = requiredGuestMemoryByteLength(options, program);

  if ((tierMode === TierMode.T1_ONLY || tierMode === TierMode.T2_ONLY) && byteLength <= 0) {
    throw new RangeError(`${tierModeName(tierMode)} guestMemoryByteLength must be positive`);
  }

  if (tierMode === TierMode.T1_ONLY || tierMode === TierMode.T2_ONLY) {
    const wasmGuestMemory = new WebAssembly.Memory({ initial: wasmPagesForByteLength(byteLength) });

    return {
      guestMemory: new ArrayBufferGuestMemory(wasmGuestMemory.buffer),
      wasmGuestMemory
    };
  }

  return { guestMemory: new ArrayBufferGuestMemory(byteLength) };
}

function requiredGuestMemoryByteLength(
  options: RuntimeInstanceOptions,
  program: readonly RuntimeProgramRegion[]
): number {
  return Math.max(
    options.guestMemoryByteLength ?? defaultGuestMemoryByteLength,
    requiredProgramByteLength(program) ?? 0
  );
}

function loadProgramBytesToGuestMemory(program: readonly RuntimeProgramRegion[], guestMemory: GuestMemory): void {
  const fault = loadProgramRegions(guestMemory, program);

  if (fault !== undefined) {
    throw new RangeError(`program byte load fault at 0x${fault.faultAddress.toString(16)}`);
  }
}

function requiredWasmGuestMemory(
  resources: RuntimeGuestMemoryResources,
  tierName: string
): WasmInterpreterRuntime {
  if (resources.wasmGuestMemory === undefined) {
    throw new Error(`${tierName} runtime requires runtime-owned WebAssembly guest memory`);
  }

  return new WasmInterpreterRuntime(resources.wasmGuestMemory);
}

function tierModeName(tierMode: TierMode): string {
  switch (tierMode) {
    case TierMode.T0_ONLY:
      return "T0";
    case TierMode.T1_ONLY:
      return "T1";
    case TierMode.T2_ONLY:
      return "T2";
  }
}

function wasmPagesForByteLength(byteLength: number): number {
  return Math.ceil(byteLength / wasmPageByteLength);
}
