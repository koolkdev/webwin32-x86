import { deepStrictEqual, strictEqual } from "node:assert";

import type { DecodedBlock } from "../arch/x86/block-decoder/decode-block.js";
import type { DecodedInstruction } from "../arch/x86/instruction/types.js";
import { StopReason, type RunResult } from "../core/execution/run-result.js";
import { cloneCpuState, cpuStateFields, createCpuState, type CpuState } from "../core/state/cpu-state.js";
import { runInstructionInterpreter } from "../interp/interpreter.js";
import { wasmBlockExportName, wasmImport, stateOffset } from "../wasm/abi.js";
import { WasmBlockCompiler } from "../wasm/codegen/block.js";
import { decodeExit, type DecodedExit } from "../wasm/exit.js";
import { decodeBytes, startAddress } from "./x86-code.js";

export { decodeBytes, startAddress };

export const statePtr = 32;
const blockCompiler = new WasmBlockCompiler();

export type StateSlot = keyof typeof stateOffset;

export type CompiledWasmBlock = Readonly<{
  module: WebAssembly.Module;
  run(initialState: CpuState, options?: RunWasmBlockOptions): Promise<WasmBlockRunResult>;
}>;

export type WasmBlockRunResult = Readonly<{
  stateView: DataView;
  guestView: DataView;
  exit: DecodedExit;
}>;

export type RunWasmBlockOptions = Readonly<{
  guest?: WebAssembly.Memory;
}>;

export type WasmInterpreterRun = Readonly<{
  interpreterResult: RunResult;
  interpreterState: CpuState;
  wasmResult: WasmBlockRunResult;
}>;

export async function compileWasmBlock(bytes: readonly number[]): Promise<CompiledWasmBlock> {
  return compiledWasmBlock(await blockCompiler.compileInstructions(decodeBytes(bytes)));
}

export async function compileDecodedWasmBlock(block: DecodedBlock): Promise<CompiledWasmBlock> {
  return compiledWasmBlock(await blockCompiler.compileDecodedBlock(block));
}

export async function compileAndRunBlock(
  bytes: readonly number[],
  initialState: CpuState = createCpuState({ eip: startAddress }),
  options: RunWasmBlockOptions = {}
): Promise<WasmBlockRunResult> {
  const block = await compileWasmBlock(bytes);

  return block.run(initialState, options);
}

export async function runWasmAndInterpreter(
  bytes: readonly number[],
  initialState: CpuState
): Promise<WasmInterpreterRun> {
  const interpreterState = cloneCpuState(initialState);
  const interpreterResult = runInstructionInterpreter(interpreterState, decodeBytes(bytes));
  const wasmResult = await compileAndRunBlock(bytes, initialState);

  return {
    interpreterResult,
    interpreterState,
    wasmResult
  };
}

export async function assertWasmMatchesInterpreter(
  bytes: readonly number[],
  initialState: CpuState
): Promise<WasmInterpreterRun> {
  const result = await runWasmAndInterpreter(bytes, initialState);

  strictEqual(result.interpreterResult.stopReason, StopReason.NONE);
  assertStateEquals(result.wasmResult.stateView, result.interpreterState);

  return result;
}

function compiledWasmBlock(module: WebAssembly.Module): CompiledWasmBlock {
  return {
    module,
    run: (initialState, options = {}) => runCompiledModule(module, initialState, options)
  };
}

async function runCompiledModule(
  module: WebAssembly.Module,
  initialState: CpuState,
  options: RunWasmBlockOptions
): Promise<WasmBlockRunResult> {
  const state = new WebAssembly.Memory({ initial: 1 });
  const guest = options.guest ?? new WebAssembly.Memory({ initial: 1 });
  const stateView = new DataView(state.buffer);
  const guestView = new DataView(guest.buffer);

  writeState(stateView, initialState);

  const instance = await WebAssembly.instantiate(module, {
    [wasmImport.moduleName]: {
      [wasmImport.stateMemoryName]: state,
      [wasmImport.guestMemoryName]: guest
    }
  });
  const run = readExportedFunction(instance, wasmBlockExportName);
  const encodedExit: unknown = run(statePtr);

  if (typeof encodedExit !== "bigint") {
    throw new Error(`expected bigint exit result, got ${typeof encodedExit}`);
  }

  return {
    stateView,
    guestView,
    exit: decodeExit(encodedExit)
  };
}

export function writeState(view: DataView, state: CpuState): void {
  for (const field of cpuStateFields) {
    view.setUint32(statePtr + stateOffset[field], state[field], true);
  }
}

export function readStateU32(view: DataView, field: StateSlot): number {
  return view.getUint32(statePtr + stateOffset[field], true);
}

export function readCpuState(view: DataView): CpuState {
  const state = createCpuState();

  copyStateFromView(view, state);
  return state;
}

export function copyStateFromView(view: DataView, state: CpuState): void {
  for (const field of cpuStateFields) {
    state[field] = readStateU32(view, field);
  }
}

export function assertStateEquals(view: DataView, state: CpuState): void {
  for (const field of cpuStateFields) {
    strictEqual(readStateU32(view, field), state[field]);
  }
}

export function createGuestMemory(): WebAssembly.Memory {
  return new WebAssembly.Memory({ initial: 1 });
}

export function fillViewBytes(view: DataView, address: number, length: number, value: number): void {
  for (let index = 0; index < length; index += 1) {
    view.setUint8(address + index, value);
  }
}

export function readViewBytes(view: DataView, address: number, length: number): number[] {
  const bytes: number[] = [];

  for (let index = 0; index < length; index += 1) {
    bytes.push(view.getUint8(address + index));
  }

  return bytes;
}

export function assertMemoryImports(module: WebAssembly.Module): void {
  const memoryImports = WebAssembly.Module.imports(module)
    .filter((entry) => entry.kind === "memory")
    .map((entry) => ({ module: entry.module, name: entry.name, kind: entry.kind }));

  deepStrictEqual(memoryImports, [
    { module: wasmImport.moduleName, name: wasmImport.stateMemoryName, kind: "memory" },
    { module: wasmImport.moduleName, name: wasmImport.guestMemoryName, kind: "memory" }
  ]);
}

function readExportedFunction(instance: WebAssembly.Instance, name: string): (...args: number[]) => unknown {
  const value = instance.exports[name];

  if (typeof value !== "function") {
    throw new Error(`expected exported function '${name}'`);
  }

  return value as (...args: number[]) => unknown;
}
