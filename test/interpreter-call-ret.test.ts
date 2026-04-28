import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import { StopReason, type RunResult } from "../src/core/execution/run-result.js";
import { ArrayBufferGuestMemory, type GuestMemory, type MemoryReadResult } from "../src/core/memory/guest-memory.js";
import { cloneCpuState, createCpuState, type CpuState } from "../src/core/state/cpu-state.js";
import { runInstructionInterpreter, type InterpreterRunOptions } from "../src/interp/interpreter.js";

const startAddress = 0x1000;

test("call_ret_returns_to_next_instruction", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ esp: 0x40, eip: startAddress });
  const result = runBytes(
    state,
    [
      0xe8, 0x02, 0x00, 0x00, 0x00,
      0xeb, 0x06,
      0xb8, 0x78, 0x56, 0x34, 0x12,
      0xc3
    ],
    { memory }
  );

  strictEqual(result.stopReason, StopReason.NONE);
  strictEqual(state.eax, 0x1234_5678);
  strictEqual(state.esp, 0x40);
  strictEqual(state.eip, 0x100d);
  strictEqual(state.instructionCount, 4);
});

test("ret_imm_cleans_stack", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ esp: 0x20, eip: startAddress });
  const target = 0x2000;

  writeU32(memory, 0x20, target);

  const result = runBytes(state, [0xc2, 0x08, 0x00], { memory });

  strictEqual(result.stopReason, StopReason.NONE);
  strictEqual(state.eip, target);
  strictEqual(state.esp, 0x2c);
  strictEqual(state.instructionCount, 1);
});

test("call_pushes_little_endian_return_address", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ esp: 0x40, eip: startAddress });
  const result = runBytes(state, [0xe8, 0x0b, 0x00, 0x00, 0x00], { memory });

  strictEqual(result.stopReason, StopReason.NONE);
  strictEqual(state.eip, 0x1010);
  strictEqual(state.esp, 0x3c);
  deepStrictEqual(readBytes(memory, 0x3c, 4), [0x05, 0x10, 0x00, 0x00]);
});

test("ret_oob_fault_atomic", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0x1234_5678, esp: 0x3e, eip: startAddress, instructionCount: 7 });

  fillMemory(memory, 0xaa);

  const beforeState = cloneCpuState(state);
  const beforeBytes = readBytes(memory, 0, memory.byteLength);
  const result = runBytes(state, [0xc3], { memory });

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

test("call_push_oob_fault_atomic", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0x1234_5678, esp: 0x42, eip: startAddress, instructionCount: 7 });

  fillMemory(memory, 0xaa);

  const beforeState = cloneCpuState(state);
  const beforeBytes = readBytes(memory, 0, memory.byteLength);
  const result = runBytes(state, [0xe8, 0x0b, 0x00, 0x00, 0x00], { memory });

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
