import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason, type RunResult } from "../../../src/core/execution/run-result.js";
import { ArrayBufferGuestMemory, type GuestMemory } from "../../../src/core/memory/guest-memory.js";
import { cloneCpuState, cpuStatesEqual, createCpuState, type CpuState } from "../../../src/core/state/cpu-state.js";
import { runInstructionInterpreter } from "../../../src/interp/interpreter.js";
import { readGuestBytes, writeGuestU32 } from "../../../src/test-support/guest-memory.js";
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

test("jit_memory_alu_load_matches_interpreter", async () => {
  const run = await runBoth(
    [0x03, 0x05, 0x20, 0x00, 0x00, 0x00],
    createCpuState({ eax: 0xffff_ffff, eflags: 0xffff_0000, eip: startAddress }),
    { memoryWrites: [{ address: 0x20, value: 1 }] }
  );

  assertStateMatchesInterpreter(run);
});

test("jit_memory_alu_store_matches_interpreter", async () => {
  const run = await runBoth(
    [0x01, 0x18],
    createCpuState({ eax: 0x20, ebx: 2, eflags: 0xffff_0000, eip: startAddress }),
    { memoryWrites: [{ address: 0x20, value: 1 }] }
  );

  assertStateMatchesInterpreter(run);
  assertMemoryRangeMatchesInterpreter(run, 0x20, 4);
});

test("jit_memory_cmp_test_matches_interpreter", async () => {
  const run = await runBoth(
    [
      0x39, 0x05, 0x20, 0x00, 0x00, 0x00,
      0x85, 0x1d, 0x24, 0x00, 0x00, 0x00
    ],
    createCpuState({ eax: 5, ebx: 0x0f, eflags: 0xffff_0000, eip: startAddress }),
    {
      memoryWrites: [
        { address: 0x20, value: 5 },
        { address: 0x24, value: 0xf0 }
      ]
    }
  );

  assertStateMatchesInterpreter(run);
  assertMemoryRangeMatchesInterpreter(run, 0x20, 8);
});

test("jit_memory_alu_imm8_matches_interpreter", async () => {
  const run = await runBoth(
    [0x83, 0x05, 0x20, 0x00, 0x00, 0x00, 0xff],
    createCpuState({ eflags: 0xffff_0000, eip: startAddress }),
    { memoryWrites: [{ address: 0x20, value: 3 }] }
  );

  assertStateMatchesInterpreter(run);
  assertMemoryRangeMatchesInterpreter(run, 0x20, 4);
});

test("jit_memory_alu_fault_atomic", async () => {
  const initialState = createCpuState({
    eax: 5,
    eflags: 0x8d5,
    eip: startAddress,
    instructionCount: 7
  });
  const run = await runBoth(
    [0x01, 0x05, 0xfe, 0xff, 0x00, 0x00],
    initialState,
    { fillMemory: 0xaa }
  );

  strictEqual(run.interpreterResult.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(run.interpreterResult.faultAddress, 0xfffe);
  strictEqual(run.interpreterResult.faultOperation, "read");
  deepStrictEqual(run.wasmResult.exit, {
    exitReason: ExitReason.MEMORY_FAULT,
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

  for (const write of options.memoryWrites ?? []) {
    wasmView.setUint32(write.address, write.value, true);
    writeGuestU32(interpreterMemory, write.address, write.value);
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
  memoryWrites?: readonly MemoryWrite[];
  fillMemory?: number;
}>;

type MemoryWrite = Readonly<{
  address: number;
  value: number;
}>;

type RunBothResult = Readonly<{
  interpreterMemory: GuestMemory;
  interpreterResult: RunResult;
  interpreterState: CpuState;
  wasmResult: WasmBlockRunResult;
  wasmState: CpuState;
  beforeWasmBytes: readonly number[];
}>;
