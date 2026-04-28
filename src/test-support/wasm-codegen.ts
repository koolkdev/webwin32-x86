import { deepStrictEqual } from "node:assert";

import { decodeOne } from "../arch/x86/decoder/decoder.js";
import type { DecodedInstruction } from "../arch/x86/instruction/types.js";
import { createCpuState, type CpuState } from "../core/state/cpu-state.js";
import { wasmBlockExportName, wasmImport, stateOffset } from "../wasm/abi.js";
import { compileBlock } from "../wasm/codegen/block.js";
import { decodeExit, type DecodedExit } from "../wasm/exit.js";

export const startAddress = 0x1000;
export const statePtr = 32;

export const stateFields = [
  "eax",
  "ecx",
  "edx",
  "ebx",
  "esp",
  "ebp",
  "esi",
  "edi",
  "eip",
  "eflags",
  "instructionCount",
  "stopReason"
] as const;

export type StateField = (typeof stateFields)[number];

export type CompiledBlockResult = Readonly<{
  module: WebAssembly.Module;
  stateView: DataView;
  exit: DecodedExit;
}>;

export async function runCompiledBlock(
  bytes: readonly number[],
  initialState: CpuState = createCpuState({ eip: startAddress })
): Promise<CompiledBlockResult> {
  const module = await WebAssembly.compile(compileBlock(decodeBytes(bytes)));
  const state = new WebAssembly.Memory({ initial: 1 });
  const guest = new WebAssembly.Memory({ initial: 1 });
  const stateView = new DataView(state.buffer);

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
    module,
    stateView,
    exit: decodeExit(encodedExit)
  };
}

export function decodeBytes(bytes: readonly number[]): DecodedInstruction[] {
  return [decodeOne(Uint8Array.from(bytes), 0, startAddress)];
}

export function writeState(view: DataView, state: CpuState): void {
  for (const field of stateFields) {
    view.setUint32(statePtr + stateOffset[field], state[field], true);
  }
}

export function readStateU32(view: DataView, field: StateField): number {
  return view.getUint32(statePtr + stateOffset[field], true);
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
