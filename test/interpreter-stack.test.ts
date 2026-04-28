import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import { StopReason, type RunResult } from "../src/core/execution/run-result.js";
import { ArrayBufferGuestMemory, type GuestMemory, type MemoryReadResult } from "../src/core/memory/guest-memory.js";
import { cloneCpuState, createCpuState, type CpuState } from "../src/core/state/cpu-state.js";
import { runInstructionInterpreter, type InterpreterRunOptions } from "../src/interp/interpreter.js";

const startAddress = 0x1000;

test("push_pop_roundtrip_register", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0x1234_5678, esp: 0x40, eip: startAddress });
  const result = runBytes(state, [0x50, 0x5b], { memory });

  strictEqual(result.stopReason, StopReason.NONE);
  strictEqual(state.ebx, 0x1234_5678);
  strictEqual(state.esp, 0x40);
  strictEqual(state.instructionCount, 2);
});

test("push_imm32_little_endian", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ esp: 0x40, eip: startAddress });
  const result = runBytes(state, [0x68, 0x44, 0x33, 0x22, 0x11], { memory });

  strictEqual(result.stopReason, StopReason.NONE);
  strictEqual(state.esp, 0x3c);
  deepStrictEqual(readBytes(memory, 0x3c, 4), [0x44, 0x33, 0x22, 0x11]);
});

test("push_imm8_sign_extended", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ esp: 0x40, eip: startAddress });
  const result = runBytes(state, [0x6a, 0xff], { memory });

  strictEqual(result.stopReason, StopReason.NONE);
  strictEqual(state.esp, 0x3c);
  deepStrictEqual(readBytes(memory, 0x3c, 4), [0xff, 0xff, 0xff, 0xff]);
});

test("pop_oob_fault_atomic", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0x1234_5678, esp: 0x3e, eip: startAddress, instructionCount: 7 });

  fillMemory(memory, 0xaa);

  const beforeState = cloneCpuState(state);
  const beforeBytes = readBytes(memory, 0, memory.byteLength);
  const result = runBytes(state, [0x58], { memory });

  strictEqual(result.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(result.faultAddress, 0x3e);
  strictEqual(result.faultSize, 4);
  strictEqual(result.faultOperation, "read");
  strictEqual(state.eax, beforeState.eax);
  strictEqual(state.esp, beforeState.esp);
  strictEqual(state.eip, beforeState.eip);
  strictEqual(state.instructionCount, beforeState.instructionCount);
  deepStrictEqual(readBytes(memory, 0, memory.byteLength), beforeBytes);
});

test("push_oob_fault_atomic", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0x1234_5678, esp: 0x42, eip: startAddress, instructionCount: 7 });

  fillMemory(memory, 0xaa);

  const beforeState = cloneCpuState(state);
  const beforeBytes = readBytes(memory, 0, memory.byteLength);
  const result = runBytes(state, [0x50], { memory });

  strictEqual(result.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(result.faultAddress, 0x3e);
  strictEqual(result.faultSize, 4);
  strictEqual(result.faultOperation, "write");
  strictEqual(state.eax, beforeState.eax);
  strictEqual(state.esp, beforeState.esp);
  strictEqual(state.eip, beforeState.eip);
  strictEqual(state.instructionCount, beforeState.instructionCount);
  deepStrictEqual(readBytes(memory, 0, memory.byteLength), beforeBytes);
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
    const result = memory.writeU8(address, value);

    if (!result.ok) {
      throw new Error(`unexpected memory fault at 0x${result.fault.faultAddress.toString(16)}`);
    }
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
