import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason, type RunResult } from "../../../src/core/execution/run-result.js";
import { ArrayBufferGuestMemory, type GuestMemory } from "../../../src/core/memory/guest-memory.js";
import { cloneCpuState, cpuStatesEqual, createCpuState, type CpuState } from "../../../src/core/state/cpu-state.js";
import { runInstructionInterpreter } from "../../../src/interp/interpreter.js";
import { readGuestBytes } from "../../../src/test-support/guest-memory.js";
import {
  compileAndRunBlock,
  decodeBytes,
  fillViewBytes,
  readCpuState,
  readViewBytes,
  type WasmBlockRunResult,
  startAddress
} from "../../../src/test-support/wasm-codegen.js";
import { ExitReason } from "../../../src/wasm/exit.js";

test("jit_push_pop_reg_matches_interpreter", async () => {
  const run = await runBoth(
    [0x50, 0x5b],
    createCpuState({ eax: 0x1234_5678, esp: 0x40, eip: startAddress })
  );

  assertStateMatchesInterpreter(run);
  assertMemoryRangeMatchesInterpreter(run, 0x3c, 4);
});

test("jit_push_imm_matches_interpreter", async () => {
  const run = await runBoth(
    [0x68, 0x44, 0x33, 0x22, 0x11, 0x6a, 0xff],
    createCpuState({ esp: 0x40, eip: startAddress })
  );

  assertStateMatchesInterpreter(run);
  assertMemoryRangeMatchesInterpreter(run, 0x38, 8);
});

test("jit_pop_fault_atomic", async () => {
  const initialState = createCpuState({
    eax: 0x1234_5678,
    esp: 0xfffe,
    eip: startAddress,
    instructionCount: 7
  });
  const run = await runBoth([0x58], initialState, { fillMemory: 0xaa });

  strictEqual(run.interpreterResult.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(run.interpreterResult.faultOperation, "read");
  deepStrictEqual(run.wasmResult.exit, {
    exitReason: ExitReason.MEMORY_READ_FAULT,
    payload: 0xfffe
  });
  deepStrictEqual(run.wasmState, initialState);
  deepStrictEqual(readViewBytes(run.wasmResult.guestView, 0xfff8, 8), run.beforeWasmBytes);
});

test("jit_push_fault_atomic", async () => {
  const initialState = createCpuState({
    eax: 0x1234_5678,
    esp: 0x1_0002,
    eip: startAddress,
    instructionCount: 7
  });
  const run = await runBoth([0x50], initialState, { fillMemory: 0xaa });

  strictEqual(run.interpreterResult.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(run.interpreterResult.faultOperation, "write");
  deepStrictEqual(run.wasmResult.exit, {
    exitReason: ExitReason.MEMORY_WRITE_FAULT,
    payload: 0xfffe
  });
  deepStrictEqual(run.wasmState, initialState);
  deepStrictEqual(readViewBytes(run.wasmResult.guestView, 0xfff8, 8), run.beforeWasmBytes);
});

async function runBoth(
  bytes: readonly number[],
  initialState: CpuState,
  options: RunBothOptions = {}
): Promise<RunBothResult> {
  const wasmGuest = new WebAssembly.Memory({ initial: 1 });
  const wasmView = new DataView(wasmGuest.buffer);
  const interpreterMemory = new ArrayBufferGuestMemory(new ArrayBuffer(wasmGuest.buffer.byteLength));
  const interpreterState = cloneCpuState(initialState);

  if (options.fillMemory !== undefined) {
    fillViewBytes(wasmView, 0, wasmView.byteLength, options.fillMemory);
    fillMemory(interpreterMemory, options.fillMemory);
  }

  const beforeWasmBytes = readViewBytes(wasmView, 0xfff8, 8);
  const interpreterResult = runInstructionInterpreter(interpreterState, decodeBytes(bytes), {
    memory: interpreterMemory
  });
  const wasmResult = await compileAndRunBlock(bytes, initialState, { guest: wasmGuest });

  return {
    interpreterMemory,
    interpreterResult,
    interpreterState,
    wasmResult,
    wasmState: readCpuState(wasmResult.stateView),
    beforeWasmBytes
  };
}

function assertStateMatchesInterpreter(run: RunBothResult): void {
  strictEqual(run.interpreterResult.stopReason, StopReason.NONE);
  strictEqual(cpuStatesEqual(run.wasmState, run.interpreterState), true);
}

function assertMemoryRangeMatchesInterpreter(run: RunBothResult, address: number, length: number): void {
  deepStrictEqual(
    readViewBytes(run.wasmResult.guestView, address, length),
    readGuestBytes(run.interpreterMemory, address, length)
  );
}

function fillMemory(memory: GuestMemory, value: number): void {
  for (let address = 0; address < memory.byteLength; address += 1) {
    memory.writeU8(address, value);
  }
}

type RunBothOptions = Readonly<{
  fillMemory?: number;
}>;

type RunBothResult = Readonly<{
  interpreterMemory: GuestMemory;
  interpreterResult: RunResult;
  interpreterState: CpuState;
  wasmResult: WasmBlockRunResult;
  wasmState: CpuState;
  beforeWasmBytes: readonly number[];
}>;
