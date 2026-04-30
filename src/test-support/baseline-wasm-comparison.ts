import { deepStrictEqual, strictEqual } from "node:assert";

import type { DecodeReader } from "../arch/x86/block-decoder/decode-reader.js";
import { decodeIsaBlock, type IsaDecodedBlock } from "../arch/x86/isa/decoder/decode-block.js";
import {
  runResultFromState,
  StopReason,
  type RunResult,
  type RunResultDetails
} from "../core/execution/run-result.js";
import { ArrayBufferGuestMemory } from "../core/memory/guest-memory.js";
import {
  cloneCpuState,
  cpuStateFields,
  cpuStatesEqual,
  createCpuState,
  type CpuState
} from "../core/state/cpu-state.js";
import { compileWasmBlockHandle, type WasmBlockHandle } from "../runtime/wasm-block/wasm-block.js";
import { DecodedBlockCache } from "../runtime/decoded-block-cache/decoded-block-cache.js";
import { DecodedBlockRunner } from "../runtime/decoded-block-runner/decoded-block-runner.js";
import { stateOffset } from "../wasm/abi.js";
import { UnsupportedWasmCodegenError } from "../wasm/codegen/errors.js";
import { ExitReason, type DecodedExit } from "../wasm/exit.js";
import { WasmInterpreterRuntime } from "../wasm/interpreter/runtime.js";

export type BaselineWasmComparisonOptions = Readonly<{
  initialState: CpuState;
  guestMemory?: WebAssembly.Memory;
  instructionLimit?: number;
}>;

export type BaselineWasmComparisonExecution = Readonly<{
  result: RunResult;
  state: CpuState;
  guestMemory: Uint8Array;
}>;

export type BaselineWasmComparisonResult = Readonly<{
  interpreter: BaselineWasmComparisonExecution;
  wasm: BaselineWasmComparisonExecution;
  report: BaselineWasmComparisonReport;
}>;

export type BaselineWasmComparisonReport = Readonly<{
  wasmByteLength: number;
  compileMs: number;
  instantiateMs: number;
  compiledBlocks: number;
  fallbackBlocks: number;
  exitCounts: BaselineWasmComparisonExitCounts;
}>;

export type BaselineWasmComparisonExitCounts = Readonly<{
  fallthrough: number;
  jump: number;
  branchTaken: number;
  branchNotTaken: number;
  hostTrap: number;
  unsupported: number;
  decodeFault: number;
  memoryFault: number;
  instructionLimit: number;
}>;

type MutableBaselineWasmComparisonReport = {
  wasmByteLength: number;
  compileMs: number;
  instantiateMs: number;
  compiledBlocks: number;
  fallbackBlocks: number;
  exitCounts: MutableBaselineWasmComparisonExitCounts;
};

type MutableBaselineWasmComparisonExitCounts = {
  -readonly [Key in keyof BaselineWasmComparisonExitCounts]: BaselineWasmComparisonExitCounts[Key];
};

const defaultInstructionLimit = 10_000;
const wasmPageByteLength = 0x1_0000;

export class BaselineWasmComparator {
  constructor(readonly decodeReader: DecodeReader) {}

  async run(options: BaselineWasmComparisonOptions): Promise<BaselineWasmComparisonResult> {
    const interpreter = this.#runInterpreter(options);
    const { execution: wasm, report } = await this.#runWasm(options);

    return {
      interpreter,
      wasm,
      report
    };
  }

  #runInterpreter(options: BaselineWasmComparisonOptions): BaselineWasmComparisonExecution {
    const state = cloneCpuState(options.initialState);
    const guestMemory = cloneGuestMemory(options.guestMemory);
    const runner = new DecodedBlockRunner(new DecodedBlockCache(this.decodeReader));
    const memory = new ArrayBufferGuestMemory(guestMemory.buffer);
    const result =
      options.instructionLimit === undefined
        ? runner.run(state, { memory })
        : runner.run(state, { instructionLimit: options.instructionLimit, memory });

    return {
      result,
      state,
      guestMemory: snapshotGuestMemory(guestMemory)
    };
  }

  async #runWasm(
    options: BaselineWasmComparisonOptions
  ): Promise<Readonly<{ execution: BaselineWasmComparisonExecution; report: BaselineWasmComparisonReport }>> {
    const stateMemory = new WebAssembly.Memory({ initial: 1 });
    const stateView = new DataView(stateMemory.buffer);
    const guestMemory = cloneGuestMemory(options.guestMemory);
    const report = createMutableReport();
    const compiledBlocks = new Map<number, WasmBlockHandle>();
    const instructionLimit = options.instructionLimit ?? defaultInstructionLimit;
    let result = runResultFromState(options.initialState, StopReason.NONE);

    writeJitState(stateView, options.initialState);

    for (let exits = 0; exits < instructionLimit; exits += 1) {
      const state = readJitState(stateView);

      if (this.decodeReader.regionAt(state.eip) === undefined) {
        return completedWasmRun(state, result, guestMemory, report);
      }

      const block = decodeIsaBlock(this.decodeReader, state.eip);

      if (block.instructions.length === 0) {
        report.fallbackBlocks += 1;
        return this.#runT1Fallback(stateView, guestMemory, options, report);
      }

      const compiled = await compiledBlockFor(compiledBlocks, block, stateMemory, guestMemory, report);

      if (compiled === undefined) {
        report.fallbackBlocks += 1;
        return this.#runT1Fallback(stateView, guestMemory, options, report);
      }

      const { exit } = compiled.run();

      incrementExit(report.exitCounts, exit.exitReason);
      const stateAfterExit = readJitState(stateView);

      result = runResultFromExit(stateAfterExit, exit);

      if (!isControlFlowExit(exit)) {
        return completedWasmRun(stateAfterExit, result, guestMemory, report);
      }
    }

    const state = readJitState(stateView);

    state.stopReason = StopReason.INSTRUCTION_LIMIT;
    return completedWasmRun(state, runResultFromState(state, StopReason.INSTRUCTION_LIMIT), guestMemory, report);
  }

  #runT1Fallback(
    stateView: DataView,
    guestMemory: WebAssembly.Memory,
    options: BaselineWasmComparisonOptions,
    report: MutableBaselineWasmComparisonReport
  ): Readonly<{ execution: BaselineWasmComparisonExecution; report: BaselineWasmComparisonReport }> {
    const state = readJitState(stateView);
    const runtime = new WasmInterpreterRuntime(guestMemory);

    runtime.copyStateToWasm(state);
    const exit = runtime.run(remainingInstructionLimit(options, state));
    runtime.copyStateFromWasm(state);
    writeJitState(stateView, state);

    return completedWasmRun(state, runResultFromExit(state, exit), guestMemory, report);
  }
}

export async function assertBaselineWasmMatchesInterpreter(
  runner: BaselineWasmComparator,
  options: BaselineWasmComparisonOptions
): Promise<BaselineWasmComparisonResult> {
  const result = await runner.run(options);

  strictEqual(result.wasm.result.stopReason, result.interpreter.result.stopReason);
  strictEqual(result.wasm.result.finalEip, result.interpreter.result.finalEip);
  strictEqual(result.wasm.result.instructionCount, result.interpreter.result.instructionCount);
  strictEqual(cpuStatesEqual(result.wasm.state, result.interpreter.state), true);
  deepStrictEqual(result.wasm.guestMemory, result.interpreter.guestMemory);

  return result;
}

function completedWasmRun(
  state: CpuState,
  result: RunResult,
  guestMemory: WebAssembly.Memory,
  report: MutableBaselineWasmComparisonReport
): Readonly<{ execution: BaselineWasmComparisonExecution; report: BaselineWasmComparisonReport }> {
  return {
    execution: {
      result,
      state,
      guestMemory: snapshotGuestMemory(guestMemory)
    },
    report: freezeReport(report)
  };
}

async function compiledBlockFor(
  compiledBlocks: Map<number, WasmBlockHandle>,
  block: IsaDecodedBlock,
  stateMemory: WebAssembly.Memory,
  guestMemory: WebAssembly.Memory,
  report: MutableBaselineWasmComparisonReport
): Promise<WasmBlockHandle | undefined> {
  const cached = compiledBlocks.get(block.startEip);

  if (cached !== undefined) {
    return cached;
  }

  let compiled: WasmBlockHandle;

  try {
    compiled = await compileWasmBlockHandle(block, { stateMemory, guestMemory });
  } catch (error: unknown) {
    if (error instanceof UnsupportedWasmCodegenError) {
      return undefined;
    }

    throw error;
  }

  report.compileMs += compiled.compileMs;
  report.instantiateMs += compiled.instantiateMs;
  report.wasmByteLength += compiled.metadata.wasmByteLength;
  report.compiledBlocks += 1;

  compiledBlocks.set(block.startEip, compiled);
  return compiled;
}

function runResultFromExit(state: CpuState, exit: DecodedExit): RunResult {
  switch (exit.exitReason) {
    case ExitReason.FALLTHROUGH:
    case ExitReason.JUMP:
    case ExitReason.BRANCH_TAKEN:
    case ExitReason.BRANCH_NOT_TAKEN:
      return runResultFromState(state, StopReason.NONE);
    case ExitReason.HOST_TRAP:
      state.stopReason = StopReason.HOST_TRAP;
      return runResultFromState(state, StopReason.HOST_TRAP, { trapVector: exit.payload });
    case ExitReason.UNSUPPORTED:
      state.stopReason = StopReason.UNSUPPORTED;
      return runResultFromState(state, StopReason.UNSUPPORTED, unsupportedDetails(exit.payload));
    case ExitReason.DECODE_FAULT:
      state.stopReason = StopReason.DECODE_FAULT;
      return runResultFromState(state, StopReason.DECODE_FAULT, {
        faultAddress: exit.payload,
        faultOperation: "execute"
      });
    case ExitReason.MEMORY_READ_FAULT:
      return stopWithMemoryFault(state, exit, "read");
    case ExitReason.MEMORY_WRITE_FAULT:
      return stopWithMemoryFault(state, exit, "write");
    case ExitReason.INSTRUCTION_LIMIT:
      state.stopReason = StopReason.INSTRUCTION_LIMIT;
      return runResultFromState(state, StopReason.INSTRUCTION_LIMIT);
  }
}

function unsupportedDetails(byte: number): RunResultDetails {
  return {
    unsupportedByte: byte & 0xff,
    unsupportedReason: "unsupportedOpcode"
  };
}

function stopWithMemoryFault(state: CpuState, exit: DecodedExit, faultOperation: "read" | "write"): RunResult {
  state.stopReason = StopReason.MEMORY_FAULT;
  return runResultFromState(state, StopReason.MEMORY_FAULT, {
    faultAddress: exit.payload,
    faultSize: 4,
    faultOperation
  });
}

function isControlFlowExit(exit: DecodedExit): boolean {
  switch (exit.exitReason) {
    case ExitReason.FALLTHROUGH:
    case ExitReason.JUMP:
    case ExitReason.BRANCH_TAKEN:
    case ExitReason.BRANCH_NOT_TAKEN:
      return true;
    default:
      return false;
  }
}

function remainingInstructionLimit(options: BaselineWasmComparisonOptions, state: CpuState): number {
  const limit = options.instructionLimit ?? defaultInstructionLimit;
  const executed = Math.max(0, state.instructionCount - options.initialState.instructionCount);

  return Math.max(0, limit - executed);
}

function writeJitState(view: DataView, state: CpuState): void {
  for (const field of cpuStateFields) {
    view.setUint32(stateOffset[field], state[field], true);
  }
}

function readJitState(view: DataView): CpuState {
  const state = createCpuState();

  for (const field of cpuStateFields) {
    state[field] = view.getUint32(stateOffset[field], true);
  }

  return state;
}

function cloneGuestMemory(source: WebAssembly.Memory | undefined): WebAssembly.Memory {
  const sourceBytes = source === undefined ? new Uint8Array() : new Uint8Array(source.buffer);
  const pages = Math.max(1, Math.ceil(sourceBytes.byteLength / wasmPageByteLength));
  const memory = new WebAssembly.Memory({ initial: pages });

  new Uint8Array(memory.buffer).set(sourceBytes);
  return memory;
}

function snapshotGuestMemory(memory: WebAssembly.Memory): Uint8Array {
  return Uint8Array.from(new Uint8Array(memory.buffer));
}

function createMutableReport(): MutableBaselineWasmComparisonReport {
  return {
    wasmByteLength: 0,
    compileMs: 0,
    instantiateMs: 0,
    compiledBlocks: 0,
    fallbackBlocks: 0,
    exitCounts: {
      fallthrough: 0,
      jump: 0,
      branchTaken: 0,
      branchNotTaken: 0,
      hostTrap: 0,
      unsupported: 0,
      decodeFault: 0,
      memoryFault: 0,
      instructionLimit: 0
    }
  };
}

function freezeReport(report: MutableBaselineWasmComparisonReport): BaselineWasmComparisonReport {
  return {
    wasmByteLength: report.wasmByteLength,
    compileMs: report.compileMs,
    instantiateMs: report.instantiateMs,
    compiledBlocks: report.compiledBlocks,
    fallbackBlocks: report.fallbackBlocks,
    exitCounts: { ...report.exitCounts }
  };
}

function incrementExit(counts: MutableBaselineWasmComparisonExitCounts, exitReason: ExitReason): void {
  counts[exitCountKey(exitReason)] += 1;
}

function exitCountKey(exitReason: ExitReason): keyof BaselineWasmComparisonExitCounts {
  switch (exitReason) {
    case ExitReason.FALLTHROUGH:
      return "fallthrough";
    case ExitReason.JUMP:
      return "jump";
    case ExitReason.BRANCH_TAKEN:
      return "branchTaken";
    case ExitReason.BRANCH_NOT_TAKEN:
      return "branchNotTaken";
    case ExitReason.HOST_TRAP:
      return "hostTrap";
    case ExitReason.UNSUPPORTED:
      return "unsupported";
    case ExitReason.DECODE_FAULT:
      return "decodeFault";
    case ExitReason.MEMORY_READ_FAULT:
    case ExitReason.MEMORY_WRITE_FAULT:
      return "memoryFault";
    case ExitReason.INSTRUCTION_LIMIT:
      return "instructionLimit";
  }
}
