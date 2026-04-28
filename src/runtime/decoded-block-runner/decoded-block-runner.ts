import type { BlockTerminator, DecodedBlock } from "../../arch/x86/block-decoder/decode-block.js";
import type { DecodeReader } from "../../arch/x86/block-decoder/decode-reader.js";
import { runResultFromState, StopReason, type RunResult } from "../../core/execution/run-result.js";
import type { GuestMemory } from "../../core/memory/guest-memory.js";
import { u32, type CpuState } from "../../core/state/cpu-state.js";
import { executeInstruction } from "../../interp/interpreter.js";
import { DecodedBlockCache, type DecodedBlockKey } from "../decoded-block-cache/decoded-block-cache.js";

export type ProfileCounters = Readonly<{
  blockHits: ReadonlyMap<DecodedBlockKey, number>;
  edgeHits: ReadonlyMap<DecodedBlockKey, ReadonlyMap<DecodedBlockKey, number>>;
  instructionsExecuted: number;
}>;

export type DecodedBlockRunnerOptions = Readonly<{
  instructionLimit?: number;
  memory?: GuestMemory;
}>;

export type DecodedBlockRunOptions = Readonly<{
  instructionLimit: number;
  memory?: GuestMemory;
}>;

export type DecodedBlockRun = Readonly<{
  result: RunResult;
  instructionsExecuted: number;
}>;

const defaultInstructionLimit = 10_000;

export class DecodedBlockRunner {
  readonly cache: DecodedBlockCache;
  readonly #blockHits = new Map<DecodedBlockKey, number>();
  readonly #edgeHits = new Map<DecodedBlockKey, Map<DecodedBlockKey, number>>();
  #instructionsExecuted = 0;

  constructor(cache: DecodedBlockCache) {
    this.cache = cache;
  }

  get counters(): ProfileCounters {
    return {
      blockHits: new Map(this.#blockHits),
      edgeHits: cloneEdgeHits(this.#edgeHits),
      instructionsExecuted: this.#instructionsExecuted
    };
  }

  run(state: CpuState, options: DecodedBlockRunnerOptions = {}): RunResult {
    const instructionLimit = options.instructionLimit ?? defaultInstructionLimit;
    let executed = 0;
    let result = runResultFromState(state, StopReason.NONE);

    while (executed < instructionLimit) {
      const currentEip = u32(state.eip);
      const block = this.cache.getOrDecode(currentEip);
      const blockRun = this.runBlock(state, block, blockRunOptions(options, instructionLimit - executed));

      executed += blockRun.instructionsExecuted;
      result = blockRun.result;

      if (result.stopReason !== StopReason.NONE) {
        return result;
      }

      const nextEip = u32(state.eip);
      if (this.cache.decodeReader.regionAt(nextEip) === undefined) {
        return result;
      }

      this.recordEdge(currentEip, nextEip);
    }

    return stopWithInstructionLimit(state);
  }

  runBlock(state: CpuState, block: DecodedBlock, options: DecodedBlockRunOptions): DecodedBlockRun {
    let executed = 0;
    let result = runResultFromState(state, StopReason.NONE);

    increment(this.#blockHits, block.startEip);

    for (const instruction of block.instructions) {
      if (executed >= options.instructionLimit) {
        return { result: stopWithInstructionLimit(state), instructionsExecuted: executed };
      }

      result =
        options.memory === undefined
          ? executeInstruction(state, instruction)
          : executeInstruction(state, instruction, { memory: options.memory });
      executed += 1;
      this.#instructionsExecuted += 1;

      if (result.stopReason !== StopReason.NONE) {
        return { result, instructionsExecuted: executed };
      }
    }

    const terminatorResult = stopAtMetadataTerminator(state, block.terminator);

    return {
      result: terminatorResult ?? result,
      instructionsExecuted: executed
    };
  }

  recordEdge(from: DecodedBlockKey, to: DecodedBlockKey): void {
    incrementEdge(this.#edgeHits, from, to);
  }
}

function blockRunOptions(options: DecodedBlockRunnerOptions, instructionLimit: number): DecodedBlockRunOptions {
  return options.memory === undefined
    ? { instructionLimit }
    : { instructionLimit, memory: options.memory };
}

function stopAtMetadataTerminator(state: CpuState, terminator: BlockTerminator): RunResult | undefined {
  switch (terminator.kind) {
    case "decode-fault":
      state.stopReason = StopReason.DECODE_FAULT;
      return runResultFromState(state, StopReason.DECODE_FAULT, {
        faultAddress: terminator.fault.address,
        faultSize: terminator.fault.raw.length,
        faultOperation: "execute"
      });
    case "host-call":
      state.stopReason = StopReason.HOST_CALL;
      return runResultFromState(state, StopReason.HOST_CALL, {
        hostCallId: terminator.hostCallId,
        hostCallName: terminator.name
      });
    default:
      return undefined;
  }
}

function stopWithInstructionLimit(state: CpuState): RunResult {
  state.stopReason = StopReason.INSTRUCTION_LIMIT;
  return runResultFromState(state, StopReason.INSTRUCTION_LIMIT);
}

function increment<Key>(counts: Map<Key, number>, key: Key): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function incrementEdge(
  counts: Map<DecodedBlockKey, Map<DecodedBlockKey, number>>,
  from: DecodedBlockKey,
  to: DecodedBlockKey
): void {
  let toCounts = counts.get(from);

  if (toCounts === undefined) {
    toCounts = new Map();
    counts.set(from, toCounts);
  }

  increment(toCounts, to);
}

function cloneEdgeHits(
  hits: Map<DecodedBlockKey, Map<DecodedBlockKey, number>>
): ReadonlyMap<DecodedBlockKey, ReadonlyMap<DecodedBlockKey, number>> {
  const clone = new Map<DecodedBlockKey, ReadonlyMap<DecodedBlockKey, number>>();

  for (const [from, toCounts] of hits) {
    clone.set(from, new Map(toCounts));
  }

  return clone;
}
