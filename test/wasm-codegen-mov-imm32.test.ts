import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import type { DecodedInstruction, Reg32 } from "../src/arch/x86/instruction/types.js";
import { StopReason } from "../src/core/execution/run-result.js";
import { createCpuState, type CpuState } from "../src/core/state/cpu-state.js";
import { runInstructionInterpreter } from "../src/interp/interpreter.js";
import { wasmBlockExportName, wasmImport, stateOffset } from "../src/wasm/abi.js";
import { compileBlock } from "../src/wasm/codegen/block.js";
import { decodeExit, ExitReason, type DecodedExit } from "../src/wasm/exit.js";

const startAddress = 0x1000;
const statePtr = 32;
const stateFields = [
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

test("jit_mov_eax_imm32", async () => {
  const result = await runCompiledBlock([0xb8, 0x78, 0x56, 0x34, 0x12]);

  assertMemoryImports(result.module);
  strictEqual(readStateU32(result.stateView, "eax"), 0x1234_5678);
  strictEqual(readStateU32(result.stateView, "eip"), 0x1005);
  strictEqual(readStateU32(result.stateView, "instructionCount"), 1);
  deepStrictEqual(result.exit, {
    exitReason: ExitReason.FALLTHROUGH,
    payload: 0x1005
  });
});

test("jit_mov_edi_imm32", async () => {
  const result = await runCompiledBlock([0xbf, 0xff, 0xff, 0xff, 0xff]);

  strictEqual(readStateU32(result.stateView, "edi"), 0xffff_ffff);
  strictEqual(readStateU32(result.stateView, "eip"), 0x1005);
  strictEqual(readStateU32(result.stateView, "instructionCount"), 1);
  deepStrictEqual(result.exit, {
    exitReason: ExitReason.FALLTHROUGH,
    payload: 0x1005
  });
});

test("jit_matches_interpreter_mov", async () => {
  const fixtures: readonly MovFixture[] = [
    { bytes: [0xb8, 0x78, 0x56, 0x34, 0x12], reg: "eax" },
    { bytes: [0xbf, 0xff, 0xff, 0xff, 0xff], reg: "edi" }
  ];

  for (const fixture of fixtures) {
    const instruction = decodeBytes(fixture.bytes)[0];

    if (instruction === undefined) {
      throw new Error("expected decoded instruction");
    }

    const interpreterState = createCpuState({ eip: startAddress });
    const interpreterResult = runInstructionInterpreter(interpreterState, [instruction]);
    const wasmResult = await runCompiledBlock(fixture.bytes);

    strictEqual(interpreterResult.stopReason, StopReason.NONE);
    strictEqual(readStateU32(wasmResult.stateView, fixture.reg), interpreterState[fixture.reg]);
    strictEqual(readStateU32(wasmResult.stateView, "eip"), interpreterState.eip);
    strictEqual(readStateU32(wasmResult.stateView, "instructionCount"), interpreterState.instructionCount);
  }
});

async function runCompiledBlock(bytes: readonly number[]): Promise<CompiledBlockResult> {
  const instructions = decodeBytes(bytes);
  const module = await WebAssembly.compile(compileBlock(instructions));
  const state = new WebAssembly.Memory({ initial: 1 });
  const guest = new WebAssembly.Memory({ initial: 1 });
  const stateView = new DataView(state.buffer);

  writeState(stateView, createCpuState({ eip: startAddress }));

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

function decodeBytes(bytes: readonly number[]): DecodedInstruction[] {
  return [decodeOne(Uint8Array.from(bytes), 0, startAddress)];
}

function writeState(view: DataView, state: CpuState): void {
  for (const field of stateFields) {
    view.setUint32(statePtr + stateOffset[field], state[field], true);
  }
}

function readStateU32(view: DataView, field: (typeof stateFields)[number]): number {
  return view.getUint32(statePtr + stateOffset[field], true);
}

function assertMemoryImports(module: WebAssembly.Module): void {
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

type CompiledBlockResult = Readonly<{
  module: WebAssembly.Module;
  stateView: DataView;
  exit: DecodedExit;
}>;

type MovFixture = Readonly<{
  bytes: readonly number[];
  reg: Reg32;
}>;
