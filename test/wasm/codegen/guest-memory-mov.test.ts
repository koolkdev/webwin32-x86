import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { createCpuState } from "../../../src/core/state/cpu-state.js";
import { ExitReason } from "../../../src/wasm/exit.js";
import {
  assertStateEquals,
  compileAndRunBlock,
  createGuestMemory,
  fillViewBytes,
  readStateU32,
  readViewBytes,
  startAddress,
  statePtr
} from "../../../src/test-support/wasm-codegen.js";

test("jit_guest_load_u32", async () => {
  const guest = createGuestMemory();
  new DataView(guest.buffer).setUint32(0x20, 0x1234_5678, true);

  const result = await compileAndRunBlock(
    [0x8b, 0x05, 0x20, 0x00, 0x00, 0x00],
    createCpuState({ eip: startAddress }),
    { guest }
  );

  strictEqual(readStateU32(result.stateView, "eax"), 0x1234_5678);
  strictEqual(readStateU32(result.stateView, "eip"), startAddress + 6);
  strictEqual(readStateU32(result.stateView, "instructionCount"), 1);
  deepStrictEqual(result.exit, {
    exitReason: ExitReason.FALLTHROUGH,
    payload: startAddress + 6
  });
});

test("jit_guest_store_u32", async () => {
  const guest = createGuestMemory();
  const result = await compileAndRunBlock(
    [0x89, 0x05, 0x20, 0x00, 0x00, 0x00],
    createCpuState({ eax: 0x1234_5678, eip: startAddress }),
    { guest }
  );

  deepStrictEqual(readViewBytes(result.guestView, 0x20, 4), [0x78, 0x56, 0x34, 0x12]);
  strictEqual(readStateU32(result.stateView, "eip"), startAddress + 6);
  strictEqual(readStateU32(result.stateView, "instructionCount"), 1);
});

test("jit_guest_memory_uses_index_1", async () => {
  const guest = createGuestMemory();
  const result = await compileAndRunBlock(
    [0x89, 0x1d, statePtr, 0x00, 0x00, 0x00],
    createCpuState({ eax: 0x1111_1111, ebx: 0x2222_2222, eip: startAddress }),
    { guest }
  );

  strictEqual(readStateU32(result.stateView, "eax"), 0x1111_1111);
  strictEqual(result.guestView.getUint32(statePtr, true), 0x2222_2222);
});

test("jit_guest_load_oob_fault_atomic", async () => {
  const guest = createGuestMemory();
  const initialState = createCpuState({
    eax: 0x1111_1111,
    eflags: 0xffff_0000,
    eip: startAddress,
    instructionCount: 7
  });
  const beforeGuest = readViewBytes(new DataView(guest.buffer), 0, 16);
  const result = await compileAndRunBlock(
    [0x8b, 0x05, 0x00, 0x00, 0x01, 0x00],
    initialState,
    { guest }
  );

  deepStrictEqual(result.exit, {
    exitReason: ExitReason.MEMORY_FAULT,
    payload: 0x1_0000
  });
  assertStateEquals(result.stateView, initialState);
  deepStrictEqual(readViewBytes(result.guestView, 0, 16), beforeGuest);
});

test("jit_guest_store_oob_fault_atomic", async () => {
  const guest = createGuestMemory();
  const guestView = new DataView(guest.buffer);
  fillViewBytes(guestView, 0xfff8, 8, 0xaa);

  const initialState = createCpuState({
    eax: 0x1234_5678,
    eflags: 0xffff_0000,
    eip: startAddress,
    instructionCount: 7
  });
  const beforeGuest = readViewBytes(guestView, 0xfff8, 8);
  const result = await compileAndRunBlock(
    [0x89, 0x05, 0xfe, 0xff, 0x00, 0x00],
    initialState,
    { guest }
  );

  deepStrictEqual(result.exit, {
    exitReason: ExitReason.MEMORY_FAULT,
    payload: 0xfffe
  });
  assertStateEquals(result.stateView, initialState);
  deepStrictEqual(readViewBytes(result.guestView, 0xfff8, 8), beforeGuest);
});
