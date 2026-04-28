import { deepStrictEqual, strictEqual } from "node:assert";
import { performance } from "node:perf_hooks";

import type { DecodedBlock } from "../arch/x86/block-decoder/decode-block.js";
import type { DecodeReader } from "../arch/x86/block-decoder/decode-reader.js";
import { runResultFromState, StopReason, type RunResult } from "../core/execution/run-result.js";
import { ArrayBufferGuestMemory } from "../core/memory/guest-memory.js";
import { cloneCpuState, cpuStatesEqual, type CpuState } from "../core/state/cpu-state.js";
import { DecodedBlockCache } from "../runtime/decoded-block-cache/decoded-block-cache.js";
import { DecodedBlockRunner } from "../runtime/decoded-block-runner/decoded-block-runner.js";
import { wasmBlockExportName, wasmImport } from "../wasm/abi.js";
import { WasmBlockCompiler } from "../wasm/codegen/block.js";
import { UnsupportedWasmCodegenError } from "../wasm/codegen/errors.js";
import { decodeExit, ExitReason, type DecodedExit } from "../wasm/exit.js";
import { readCpuState, statePtr, writeState } from "./wasm-codegen.js";

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
  readonly #compiler = new WasmBlockCompiler();

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
    const cache = new DecodedBlockCache(this.decodeReader);
    const report = createMutableReport();
    const compiledBlocks = new Map<number, CompiledComparisonBlock>();
    const imports = wasmImports(stateMemory, guestMemory);
    const instructionLimit = options.instructionLimit ?? defaultInstructionLimit;
    let result = runResultFromState(options.initialState, StopReason.NONE);

    writeState(stateView, options.initialState);

    for (let exits = 0; exits < instructionLimit; exits += 1) {
      const state = readCpuState(stateView);

      if (this.decodeReader.regionAt(state.eip) === undefined) {
        return completedWasmRun(state, result, guestMemory, report);
      }

      const block = cache.getOrDecode(state.eip);
      const compiled = await compiledBlockFor(compiledBlocks, block, imports, report, this.#compiler);

      if (compiled === undefined) {
        report.fallbackBlocks += 1;
        return this.#runFallback(stateView, guestMemory, options, report);
      }

      const exit = compiled.run();

      incrementExit(report.exitCounts, exit.exitReason);
      const stateAfterExit = readCpuState(stateView);

      result = runResultFromExit(stateAfterExit, exit);

      if (!isControlFlowExit(exit)) {
        return completedWasmRun(stateAfterExit, result, guestMemory, report);
      }
    }

    const state = readCpuState(stateView);

    state.stopReason = StopReason.INSTRUCTION_LIMIT;
    return completedWasmRun(state, runResultFromState(state, StopReason.INSTRUCTION_LIMIT), guestMemory, report);
  }

  #runFallback(
    stateView: DataView,
    guestMemory: WebAssembly.Memory,
    options: BaselineWasmComparisonOptions,
    report: MutableBaselineWasmComparisonReport
  ): Readonly<{ execution: BaselineWasmComparisonExecution; report: BaselineWasmComparisonReport }> {
    const state = readCpuState(stateView);
    const result = new DecodedBlockRunner(new DecodedBlockCache(this.decodeReader)).run(state, {
      instructionLimit: remainingInstructionLimit(options, state),
      memory: new ArrayBufferGuestMemory(guestMemory.buffer)
    });

    writeState(stateView, state);

    return {
      execution: {
        result,
        state,
        guestMemory: snapshotGuestMemory(guestMemory)
      },
      report: freezeReport(report)
    };
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
  compiledBlocks: Map<number, CompiledComparisonBlock>,
  block: DecodedBlock,
  imports: WebAssembly.Imports,
  report: MutableBaselineWasmComparisonReport,
  compiler: WasmBlockCompiler
): Promise<CompiledComparisonBlock | undefined> {
  const cached = compiledBlocks.get(block.startEip);

  if (cached !== undefined) {
    return cached;
  }

  let bytes: Uint8Array<ArrayBuffer>;

  try {
    bytes = compiler.encodeDecodedBlock(block);
  } catch (error: unknown) {
    if (error instanceof UnsupportedWasmCodegenError) {
      return undefined;
    }

    throw error;
  }

  const compileStart = performance.now();
  const module = await WebAssembly.compile(bytes);

  report.compileMs += performance.now() - compileStart;

  const instantiateStart = performance.now();
  const instance = await WebAssembly.instantiate(module, imports);

  report.instantiateMs += performance.now() - instantiateStart;
  report.wasmByteLength += bytes.byteLength;
  report.compiledBlocks += 1;

  const compiled = new CompiledComparisonBlock(instance);

  compiledBlocks.set(block.startEip, compiled);
  return compiled;
}

class CompiledComparisonBlock {
  readonly #run: () => unknown;

  constructor(instance: WebAssembly.Instance) {
    this.#run = readExportedBlock(instance);
  }

  run(): DecodedExit {
    const encodedExit = this.#run();

    if (typeof encodedExit !== "bigint") {
      throw new Error(`expected bigint exit result, got ${typeof encodedExit}`);
    }

    return decodeExit(encodedExit);
  }
}

function readExportedBlock(instance: WebAssembly.Instance): () => unknown {
  const run = instance.exports[wasmBlockExportName];

  if (typeof run !== "function") {
    throw new Error(`expected exported function '${wasmBlockExportName}'`);
  }

  return () => run(statePtr);
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
      return runResultFromState(state, StopReason.UNSUPPORTED);
    case ExitReason.DECODE_FAULT:
      state.stopReason = StopReason.DECODE_FAULT;
      return runResultFromState(state, StopReason.DECODE_FAULT, {
        faultAddress: exit.payload,
        faultOperation: "execute"
      });
    case ExitReason.MEMORY_FAULT:
      state.stopReason = StopReason.MEMORY_FAULT;
      return runResultFromState(state, StopReason.MEMORY_FAULT, {
        faultAddress: exit.payload,
        faultSize: 4
      });
    case ExitReason.INSTRUCTION_LIMIT:
      state.stopReason = StopReason.INSTRUCTION_LIMIT;
      return runResultFromState(state, StopReason.INSTRUCTION_LIMIT);
  }
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

function wasmImports(state: WebAssembly.Memory, guest: WebAssembly.Memory): WebAssembly.Imports {
  return {
    [wasmImport.moduleName]: {
      [wasmImport.stateMemoryName]: state,
      [wasmImport.guestMemoryName]: guest
    }
  };
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
    case ExitReason.MEMORY_FAULT:
      return "memoryFault";
    case ExitReason.INSTRUCTION_LIMIT:
      return "instructionLimit";
  }
}
