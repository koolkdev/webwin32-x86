import type { DecodeReader } from "../../arch/x86/block-decoder/decode-reader.js";
import { runResultFromState, StopReason, type RunResult } from "../../core/execution/run-result.js";
import { ArrayBufferGuestMemory, type GuestMemory } from "../../core/memory/guest-memory.js";
import { createCpuState, u32, type CpuState } from "../../core/state/cpu-state.js";
import { DecodedBlockCache, type DecodedBlockCacheCounters } from "../decoded-block-cache/decoded-block-cache.js";
import { DecodedBlockRunner, type ProfileCounters } from "../decoded-block-runner/decoded-block-runner.js";

export type RuntimeInstanceOptions = Readonly<{
  decodeReader: DecodeReader;
  initialState?: Partial<CpuState>;
  guestMemory?: GuestMemory;
  guestMemoryByteLength?: number;
}>;

export type RuntimeInstanceRunOptions = Readonly<{
  entryEip?: number;
  instructionLimit?: number;
}>;

export type RuntimeInstanceCounters = Readonly<{
  decodedBlockCache: DecodedBlockCacheCounters;
  profile: ProfileCounters;
}>;

const defaultGuestMemoryByteLength = 1024 * 1024;
const defaultInstructionLimit = 10_000;

export class RuntimeInstance {
  readonly state: CpuState;
  readonly guestMemory: GuestMemory;
  readonly decodeReader: DecodeReader;
  readonly decodedBlockCache: DecodedBlockCache;
  readonly #decodedBlockRunner: DecodedBlockRunner;

  constructor(options: RuntimeInstanceOptions) {
    this.state = createCpuState(options.initialState ?? {});
    this.guestMemory = options.guestMemory ?? new ArrayBufferGuestMemory(
      options.guestMemoryByteLength ?? defaultGuestMemoryByteLength
    );
    this.decodeReader = options.decodeReader;
    this.decodedBlockCache = new DecodedBlockCache(this.decodeReader);
    this.#decodedBlockRunner = new DecodedBlockRunner(this.decodedBlockCache);
  }

  get counters(): RuntimeInstanceCounters {
    return {
      decodedBlockCache: this.decodedBlockCache.counters,
      profile: this.#decodedBlockRunner.counters
    };
  }

  run(options: RuntimeInstanceRunOptions = {}): RunResult {
    if (options.entryEip !== undefined) {
      this.state.eip = u32(options.entryEip);
    }

    const instructionLimit = options.instructionLimit ?? defaultInstructionLimit;
    let executed = 0;
    let result = runResultFromState(this.state, StopReason.NONE);

    while (executed < instructionLimit) {
      const currentEip = u32(this.state.eip);
      const block = this.decodedBlockCache.getOrDecode(currentEip);
      const blockRun = this.#decodedBlockRunner.runBlock(this.state, block, {
        instructionLimit: instructionLimit - executed,
        memory: this.guestMemory
      });

      executed += blockRun.instructionsExecuted;
      result = blockRun.result;

      if (result.stopReason !== StopReason.NONE) {
        return result;
      }

      const nextEip = u32(this.state.eip);
      if (this.decodeReader.regionAt(nextEip) === undefined) {
        return result;
      }

      this.#decodedBlockRunner.recordEdge(currentEip, nextEip);
    }

    this.state.stopReason = StopReason.INSTRUCTION_LIMIT;
    return runResultFromState(this.state, StopReason.INSTRUCTION_LIMIT);
  }
}
