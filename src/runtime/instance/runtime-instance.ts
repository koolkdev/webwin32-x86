import type { DecodeReader } from "../../arch/x86/block-decoder/decode-reader.js";
import type { RunResult } from "../../core/execution/run-result.js";
import { ArrayBufferGuestMemory, type GuestMemory } from "../../core/memory/guest-memory.js";
import { createCpuState, type CpuState } from "../../core/state/cpu-state.js";
import { DecodedBlockCache, type DecodedBlockCacheCounters } from "../decoded-block-cache/decoded-block-cache.js";
import { DecodedBlockRunner, type ProfileCounters } from "../decoded-block-runner/decoded-block-runner.js";

export type RuntimeInstanceOptions = Readonly<{
  decodeReader: DecodeReader;
  initialState?: Partial<CpuState>;
  guestMemory?: GuestMemory;
  guestMemoryByteLength?: number;
}>;

export type RuntimeInstanceRunOptions = Readonly<{
  instructionLimit?: number;
}>;

export type RuntimeInstanceCounters = Readonly<{
  decodedBlockCache: DecodedBlockCacheCounters;
  profile: ProfileCounters;
}>;

const defaultGuestMemoryByteLength = 1024 * 1024;

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
    const runnerOptions =
      options.instructionLimit === undefined
        ? { memory: this.guestMemory }
        : { memory: this.guestMemory, instructionLimit: options.instructionLimit };

    return this.#decodedBlockRunner.run(this.state, runnerOptions);
  }
}
