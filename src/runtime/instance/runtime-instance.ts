import type { DecodeReader } from "../../arch/x86/block-decoder/decode-reader.js";
import type { RunResult } from "../../core/execution/run-result.js";
import { ArrayBufferGuestMemory, type GuestMemory } from "../../core/memory/guest-memory.js";
import { createCpuState, u32, type CpuState } from "../../core/state/cpu-state.js";
import { DecodedBlockCache, type DecodedBlockCacheCounters } from "../decoded-block-cache/decoded-block-cache.js";
import { DecodedBlockRunner, type ProfileCounters } from "../decoded-block-runner/decoded-block-runner.js";
import { runT0InstructionInterpreter } from "../tiering/executors/t0-instruction-interpreter.js";
import { runT1DecodedBlocks } from "../tiering/executors/t1-decoded-blocks.js";
import type { RuntimeTierExecutionContext } from "../tiering/executors/context.js";
import { defaultTierMode, TierMode } from "../tiering/tier-policy.js";

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
  tierMode?: TierMode;
}>;

export type RuntimeInstanceCounters = Readonly<{
  decodedBlockCache: DecodedBlockCacheCounters;
  profile: ProfileCounters;
}>;

type RuntimeTierExecutor = (instructionLimit: number) => RunResult;

const defaultGuestMemoryByteLength = 1024 * 1024;
const defaultInstructionLimit = 10_000;

export class RuntimeInstance {
  readonly state: CpuState;
  readonly guestMemory: GuestMemory;
  readonly decodeReader: DecodeReader;
  readonly decodedBlockCache: DecodedBlockCache;
  readonly #defaultTierMode: TierMode;
  readonly #decodedBlockRunner: DecodedBlockRunner;
  readonly #tierExecutors: Readonly<Record<TierMode, RuntimeTierExecutor>>;
  #tierMode: TierMode;

  constructor(options: RuntimeInstanceOptions) {
    this.state = createCpuState(options.initialState ?? {});
    this.guestMemory = options.guestMemory ?? new ArrayBufferGuestMemory(
      options.guestMemoryByteLength ?? defaultGuestMemoryByteLength
    );
    this.decodeReader = options.decodeReader;
    this.decodedBlockCache = new DecodedBlockCache(this.decodeReader);
    this.#defaultTierMode = options.tierMode ?? defaultTierMode;
    this.#tierMode = this.#defaultTierMode;
    this.#decodedBlockRunner = new DecodedBlockRunner(this.decodedBlockCache);
    this.#tierExecutors = {
      [TierMode.T0_ONLY]: (instructionLimit) => runT0InstructionInterpreter(this.#executionContext(), instructionLimit),
      [TierMode.T1_ONLY]: (instructionLimit) => runT1DecodedBlocks(this.#executionContext(), instructionLimit)
    };
  }

  get tierMode(): TierMode {
    return this.#tierMode;
  }

  get counters(): RuntimeInstanceCounters {
    return {
      decodedBlockCache: this.decodedBlockCache.counters,
      profile: this.#decodedBlockRunner.counters
    };
  }

  run(options: RuntimeInstanceRunOptions = {}): RunResult {
    const tierMode = options.tierMode ?? this.#defaultTierMode;

    if (options.entryEip !== undefined) {
      this.state.eip = u32(options.entryEip);
    }

    const instructionLimit = options.instructionLimit ?? defaultInstructionLimit;
    this.#tierMode = tierMode;

    return this.#tierExecutors[tierMode](instructionLimit);
  }

  #executionContext(): RuntimeTierExecutionContext {
    return {
      state: this.state,
      guestMemory: this.guestMemory,
      decodeReader: this.decodeReader,
      decodedBlockCache: this.decodedBlockCache,
      decodedBlockRunner: this.#decodedBlockRunner
    };
  }
}
