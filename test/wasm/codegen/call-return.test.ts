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

test("jit_call_pushes_return_address", async () => {
  const run = await runBoth(
    [0xe8, 0x0b, 0x00, 0x00, 0x00],
    createCpuState({ esp: 0x40, eip: startAddress })
  );

  assertStateMatchesInterpreter(run);
  assertMemoryRangeMatchesInterpreter(run, 0x3c, 4);
  deepStrictEqual(run.wasmResult.exit, {
    exitReason: ExitReason.JUMP,
    payload: 0x1010
  });
  deepStrictEqual(readViewBytes(run.wasmResult.guestView, 0x3c, 4), [0x05, 0x10, 0x00, 0x00]);
});

test("jit_ret_pops_eip", async () => {
  const run = await runBoth(
    [0xc3],
    createCpuState({ esp: 0x20, eip: startAddress }),
    { memoryWrites: [{ address: 0x20, value: 0x2000 }] }
  );

  assertStateMatchesInterpreter(run);
  strictEqual(run.wasmState.eip, 0x2000);
  strictEqual(run.wasmState.esp, 0x24);
  deepStrictEqual(run.wasmResult.exit, {
    exitReason: ExitReason.JUMP,
    payload: 0x2000
  });
});

test("jit_ret_imm_cleans_stack", async () => {
  const run = await runBoth(
    [0xc2, 0x08, 0x00],
    createCpuState({ esp: 0x20, eip: startAddress }),
    { memoryWrites: [{ address: 0x20, value: 0x2000 }] }
  );

  assertStateMatchesInterpreter(run);
  strictEqual(run.wasmState.eip, 0x2000);
  strictEqual(run.wasmState.esp, 0x2c);
});

test("jit_call_fault_atomic", async () => {
  const initialState = createCpuState({
    eax: 0x1234_5678,
    esp: 0x1_0002,
    eip: startAddress,
    instructionCount: 7
  });
  const run = await runBoth([0xe8, 0x0b, 0x00, 0x00, 0x00], initialState, { fillMemory: 0xaa });

  strictEqual(run.interpreterResult.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(run.interpreterResult.faultOperation, "write");
  deepStrictEqual(run.wasmResult.exit, {
    exitReason: ExitReason.MEMORY_WRITE_FAULT,
    payload: 0xfffe
  });
  deepStrictEqual(run.wasmState, initialState);
  deepStrictEqual(readViewBytes(run.wasmResult.guestView, 0xfff8, 8), run.beforeFaultBytes);
});

test("jit_ret_fault_atomic", async () => {
  const initialState = createCpuState({
    eax: 0x1234_5678,
    esp: 0xfffe,
    eip: startAddress,
    instructionCount: 7
  });
  const run = await runBoth([0xc3], initialState, { fillMemory: 0xaa });

  strictEqual(run.interpreterResult.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(run.interpreterResult.faultOperation, "read");
  deepStrictEqual(run.wasmResult.exit, {
    exitReason: ExitReason.MEMORY_READ_FAULT,
    payload: 0xfffe
  });
  deepStrictEqual(run.wasmState, initialState);
  deepStrictEqual(readViewBytes(run.wasmResult.guestView, 0xfff8, 8), run.beforeFaultBytes);
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

  const beforeFaultBytes = readViewBytes(wasmView, 0xfff8, 8);
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
    beforeFaultBytes
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
  memoryWrites?: readonly MemoryWrite[];
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
  beforeFaultBytes: readonly number[];
}>;
