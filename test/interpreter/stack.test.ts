import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason } from "../../src/core/execution/run-result.js";
import { ArrayBufferGuestMemory } from "../../src/core/memory/guest-memory.js";
import { cloneCpuState, createCpuState } from "../../src/core/state/cpu-state.js";
import { fillGuestMemory, readGuestBytes } from "../../src/test-support/guest-memory.js";
import { runBytes, startAddress } from "../../src/test-support/interpreter.js";

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
  deepStrictEqual(readGuestBytes(memory, 0x3c, 4), [0x44, 0x33, 0x22, 0x11]);
});

test("push_imm8_sign_extended", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ esp: 0x40, eip: startAddress });
  const result = runBytes(state, [0x6a, 0xff], { memory });

  strictEqual(result.stopReason, StopReason.NONE);
  strictEqual(state.esp, 0x3c);
  deepStrictEqual(readGuestBytes(memory, 0x3c, 4), [0xff, 0xff, 0xff, 0xff]);
});

test("pop_oob_fault_atomic", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0x1234_5678, esp: 0x3e, eip: startAddress, instructionCount: 7 });

  fillGuestMemory(memory, 0xaa);

  const beforeState = cloneCpuState(state);
  const beforeBytes = readGuestBytes(memory, 0, memory.byteLength);
  const result = runBytes(state, [0x58], { memory });

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

test("push_oob_fault_atomic", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0x1234_5678, esp: 0x42, eip: startAddress, instructionCount: 7 });

  fillGuestMemory(memory, 0xaa);

  const beforeState = cloneCpuState(state);
  const beforeBytes = readGuestBytes(memory, 0, memory.byteLength);
  const result = runBytes(state, [0x50], { memory });

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
