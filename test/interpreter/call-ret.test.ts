import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason } from "../../src/core/execution/run-result.js";
import { ArrayBufferGuestMemory } from "../../src/core/memory/guest-memory.js";
import { cloneCpuState, createCpuState } from "../../src/core/state/cpu-state.js";
import { fillGuestMemory, readGuestBytes, writeGuestU32 } from "../../src/test-support/guest-memory.js";
import { runBytes, startAddress } from "../../src/test-support/interpreter.js";

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

  writeGuestU32(memory, 0x20, target);

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
  deepStrictEqual(readGuestBytes(memory, 0x3c, 4), [0x05, 0x10, 0x00, 0x00]);
});

test("ret_oob_fault_atomic", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0x1234_5678, esp: 0x3e, eip: startAddress, instructionCount: 7 });

  fillGuestMemory(memory, 0xaa);

  const beforeState = cloneCpuState(state);
  const beforeBytes = readGuestBytes(memory, 0, memory.byteLength);
  const result = runBytes(state, [0xc3], { memory });

  strictEqual(result.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(result.faultAddress, 0x3e);
  strictEqual(result.faultSize, 4);
  strictEqual(result.faultOperation, "read");
  strictEqual(state.eax, beforeState.eax);
  strictEqual(state.esp, beforeState.esp);
  strictEqual(state.eip, beforeState.eip);
  strictEqual(state.instructionCount, beforeState.instructionCount);
  deepStrictEqual(readGuestBytes(memory, 0, memory.byteLength), beforeBytes);
});

test("call_push_oob_fault_atomic", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0x1234_5678, esp: 0x42, eip: startAddress, instructionCount: 7 });

  fillGuestMemory(memory, 0xaa);

  const beforeState = cloneCpuState(state);
  const beforeBytes = readGuestBytes(memory, 0, memory.byteLength);
  const result = runBytes(state, [0xe8, 0x0b, 0x00, 0x00, 0x00], { memory });

  strictEqual(result.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(result.faultAddress, 0x3e);
  strictEqual(result.faultSize, 4);
  strictEqual(result.faultOperation, "write");
  strictEqual(state.eax, beforeState.eax);
  strictEqual(state.esp, beforeState.esp);
  strictEqual(state.eip, beforeState.eip);
  strictEqual(state.instructionCount, beforeState.instructionCount);
  deepStrictEqual(readGuestBytes(memory, 0, memory.byteLength), beforeBytes);
});
