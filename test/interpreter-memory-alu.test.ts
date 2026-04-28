import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import { StopReason, type RunResult } from "../src/core/execution/run-result.js";
import { ArrayBufferGuestMemory, type GuestMemory, type MemoryReadResult } from "../src/core/memory/guest-memory.js";
import { cloneCpuState, createCpuState, getFlag, type CpuState } from "../src/core/state/cpu-state.js";
import { runInstructionInterpreter, type InterpreterRunOptions } from "../src/interp/interpreter.js";

const startAddress = 0x1000;

test("add_loads_memory_operand", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const memoryState = createCpuState({ eax: 0xffff_ffff, eip: startAddress });
  const registerState = createCpuState({ eax: 0xffff_ffff, ebx: 1, eip: startAddress });

  writeU32(memory, 0x20, 1);

  strictEqual(runBytes(memoryState, [0x03, 0x05, 0x20, 0x00, 0x00, 0x00], { memory }).stopReason, StopReason.NONE);
  strictEqual(runBytes(registerState, [0x03, 0xc3]).stopReason, StopReason.NONE);
  strictEqual(memoryState.eax, registerState.eax);
  strictEqual(memoryState.eflags, registerState.eflags);
});

test("add_stores_memory_destination", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0x20, ebx: 2, eip: startAddress });

  writeU32(memory, 0x20, 1);

  strictEqual(runBytes(state, [0x01, 0x18], { memory }).stopReason, StopReason.NONE);
  deepStrictEqual(readBytes(memory, 0x20, 4), [0x03, 0x00, 0x00, 0x00]);
});

test("cmp_memory_does_not_write", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 5, eip: startAddress });

  writeU32(memory, 0x20, 5);

  const beforeBytes = readBytes(memory, 0x20, 4);

  strictEqual(runBytes(state, [0x39, 0x05, 0x20, 0x00, 0x00, 0x00], { memory }).stopReason, StopReason.NONE);
  deepStrictEqual(readBytes(memory, 0x20, 4), beforeBytes);
  strictEqual(getFlag(state, "ZF"), true);
});

test("test_memory_does_not_write", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0x0f, eip: startAddress });

  writeU32(memory, 0x20, 0xf0);

  const beforeBytes = readBytes(memory, 0x20, 4);

  strictEqual(runBytes(state, [0x85, 0x05, 0x20, 0x00, 0x00, 0x00], { memory }).stopReason, StopReason.NONE);
  deepStrictEqual(readBytes(memory, 0x20, 4), beforeBytes);
  strictEqual(getFlag(state, "ZF"), true);
  strictEqual(getFlag(state, "CF"), false);
  strictEqual(getFlag(state, "OF"), false);
});

test("memory_alu_fault_before_write_atomic", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 5, eip: startAddress, eflags: 0x8d5, instructionCount: 7 });

  fillMemory(memory, 0xaa);

  const beforeState = cloneCpuState(state);
  const beforeBytes = readBytes(memory, 0, memory.byteLength);
  const result = runBytes(state, [0x01, 0x05, 0x3e, 0x00, 0x00, 0x00], { memory });

  strictEqual(result.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(result.faultAddress, 0x3e);
  strictEqual(result.faultSize, 4);
  strictEqual(result.faultOperation, "read");
  strictEqual(state.eax, beforeState.eax);
  strictEqual(state.eflags, beforeState.eflags);
  strictEqual(state.eip, beforeState.eip);
  strictEqual(state.instructionCount, beforeState.instructionCount);
  deepStrictEqual(readBytes(memory, 0, memory.byteLength), beforeBytes);
});

test("memory_cmp_fault_does_not_update_flags", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 1, eip: startAddress, eflags: 0x8d5, instructionCount: 7 });
  const beforeState = cloneCpuState(state);
  const result = runBytes(state, [0x3b, 0x05, 0x3e, 0x00, 0x00, 0x00], { memory });

  strictEqual(result.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(result.faultAddress, 0x3e);
  strictEqual(result.faultSize, 4);
  strictEqual(result.faultOperation, "read");
  strictEqual(state.eflags, beforeState.eflags);
  strictEqual(state.eip, beforeState.eip);
  strictEqual(state.instructionCount, beforeState.instructionCount);
});

function runBytes(
  state: CpuState,
  bytes: readonly number[],
  options: InterpreterRunOptions = {}
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
    const result = memory.writeU8(address, value);

    if (!result.ok) {
      throw new Error(`unexpected memory fault at 0x${result.fault.faultAddress.toString(16)}`);
    }
  }
}

function writeU32(memory: GuestMemory, address: number, value: number): void {
  const result = memory.writeU32(address, value);

  if (!result.ok) {
    throw new Error(`unexpected memory fault at 0x${result.fault.faultAddress.toString(16)}`);
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
