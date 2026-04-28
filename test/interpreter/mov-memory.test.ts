import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason } from "../../src/core/execution/run-result.js";
import { ArrayBufferGuestMemory } from "../../src/core/memory/guest-memory.js";
import { cloneCpuState, createCpuState } from "../../src/core/state/cpu-state.js";
import { fillGuestMemory, readGuestBytes } from "../../src/test-support/guest-memory.js";
import { runBytes, startAddress } from "../../src/test-support/interpreter.js";

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
  deepStrictEqual(readGuestBytes(memory, 0x20, 4), [0x78, 0x56, 0x34, 0x12]);
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

  deepStrictEqual(readGuestBytes(memory, 0x2c, 4), [0x78, 0x56, 0x34, 0x12]);
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

  fillGuestMemory(memory, 0xaa);

  const beforeState = cloneCpuState(state);
  const beforeBytes = readGuestBytes(memory, 0, memory.byteLength);
  const result = runBytes(state, [0x89, 0x05, 0x3e, 0x00, 0x00, 0x00], { memory });

  strictEqual(result.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(result.faultAddress, 0x3e);
  strictEqual(result.faultSize, 4);
  strictEqual(result.faultOperation, "write");
  strictEqual(state.eip, beforeState.eip);
  strictEqual(state.instructionCount, beforeState.instructionCount);
  deepStrictEqual(readGuestBytes(memory, 0, memory.byteLength), beforeBytes);
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
