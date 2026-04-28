import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import { StopReason, type RunResult } from "../src/core/execution/run-result.js";
import { ArrayBufferGuestMemory, type GuestMemory, type MemoryReadResult } from "../src/core/memory/guest-memory.js";
import { cloneCpuState, createCpuState, type CpuState } from "../src/core/state/cpu-state.js";
import { runInstructionInterpreter, type InterpreterRunOptions } from "../src/interp/interpreter.js";

const startAddress = 0x1000;

test("load_store_u32_absolute", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0x1234_5678, eip: startAddress });
  const result = runBytes(
    state,
    [
      0x89, 0x05, 0x20, 0x00, 0x00, 0x00,
      0x8b, 0x1d, 0x20, 0x00, 0x00, 0x00
    ],
    { memory }
  );

  strictEqual(result.stopReason, StopReason.NONE);
  deepStrictEqual(readBytes(memory, 0x20, 4), [0x78, 0x56, 0x34, 0x12]);
  strictEqual(state.ebx, 0x1234_5678);
  strictEqual(state.instructionCount, 2);
});

test("load_base_disp", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ ebx: 0x20, eip: startAddress });

  memory.writeU32(0x24, 0x89ab_cdef);
  runBytes(state, [0x8b, 0x43, 0x04], { memory });

  strictEqual(state.eax, 0x89ab_cdef);
});

test("store_ebp_negative_disp", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0x1234_5678, ebp: 0x30, eip: startAddress });

  runBytes(state, [0x89, 0x45, 0xfc], { memory });

  deepStrictEqual(readBytes(memory, 0x2c, 4), [0x78, 0x56, 0x34, 0x12]);
});

test("memory_bounds_error_on_load_atomic", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0x1234_5678, eip: startAddress, instructionCount: 7 });
  const before = cloneCpuState(state);
  const result = runBytes(state, [0x8b, 0x05, 0x40, 0x00, 0x00, 0x00], { memory });

  strictEqual(result.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(result.faultAddress, 0x40);
  strictEqual(result.faultSize, 4);
  strictEqual(result.faultOperation, "read");
  strictEqual(state.eax, before.eax);
  strictEqual(state.eip, before.eip);
  strictEqual(state.instructionCount, before.instructionCount);
});

test("memory_bounds_error_on_store_atomic", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0x1234_5678, eip: startAddress, instructionCount: 7 });

  fillMemory(memory, 0xaa);

  const beforeState = cloneCpuState(state);
  const beforeBytes = readBytes(memory, 0, memory.byteLength);
  const result = runBytes(state, [0x89, 0x05, 0x3e, 0x00, 0x00, 0x00], { memory });

  strictEqual(result.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(result.faultAddress, 0x3e);
  strictEqual(result.faultSize, 4);
  strictEqual(result.faultOperation, "write");
  strictEqual(state.eip, beforeState.eip);
  strictEqual(state.instructionCount, beforeState.instructionCount);
  deepStrictEqual(readBytes(memory, 0, memory.byteLength), beforeBytes);
});

test("effective_address_wrap_then_oob_fault", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0x1234_5678, ebx: 0, eip: startAddress, instructionCount: 7 });
  const before = cloneCpuState(state);
  const result = runBytes(state, [0x8b, 0x43, 0xff], { memory });

  strictEqual(result.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(result.faultAddress, 0xffff_ffff);
  strictEqual(result.faultSize, 4);
  strictEqual(result.faultOperation, "read");
  strictEqual(state.eax, before.eax);
  strictEqual(state.eip, before.eip);
  strictEqual(state.instructionCount, before.instructionCount);
});

function runBytes(
  state: CpuState,
  bytes: readonly number[],
  options: InterpreterRunOptions
): RunResult {
  return runInstructionInterpreter(state, decodeBytes(bytes), options);
}

function decodeBytes(bytes: readonly number[]) {
  const code = Uint8Array.from(bytes);
  const instructions = [];
  let offset = 0;

  while (offset < code.length) {
    const instruction = decodeOne(code, offset, startAddress + offset);
    instructions.push(instruction);
    offset += instruction.length;
  }

  return instructions;
}

function fillMemory(memory: GuestMemory, value: number): void {
  for (let address = 0; address < memory.byteLength; address += 1) {
    memory.writeU8(address, value);
  }
}

function readBytes(memory: GuestMemory, address: number, length: number): number[] {
  const bytes = [];

  for (let index = 0; index < length; index += 1) {
    bytes.push(readValue(memory.readU8(address + index)));
  }

  return bytes;
}

function readValue(result: MemoryReadResult): number {
  if (!result.ok) {
    throw new Error(`unexpected memory fault at 0x${result.fault.faultAddress.toString(16)}`);
  }

  return result.value;
}
