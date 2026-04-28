import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { cpuStateFields, createCpuState, type CpuState } from "../src/core/state/cpu-state.js";
import { ExitReason } from "../src/wasm/exit.js";
import {
  readStateU32,
  runCompiledBlock,
  startAddress,
  statePtr
} from "../src/test-support/wasm-codegen.js";

test("jit_guest_load_u32", async () => {
  const guest = guestMemory();
  new DataView(guest.buffer).setUint32(0x20, 0x1234_5678, true);

  const result = await runCompiledBlock(
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
  const guest = guestMemory();
  const result = await runCompiledBlock(
    [0x89, 0x05, 0x20, 0x00, 0x00, 0x00],
    createCpuState({ eax: 0x1234_5678, eip: startAddress }),
    { guest }
  );

  deepStrictEqual(readBytes(result.guestView, 0x20, 4), [0x78, 0x56, 0x34, 0x12]);
  strictEqual(readStateU32(result.stateView, "eip"), startAddress + 6);
  strictEqual(readStateU32(result.stateView, "instructionCount"), 1);
});

test("jit_guest_memory_uses_index_1", async () => {
  const guest = guestMemory();
  const result = await runCompiledBlock(
    [0x89, 0x1d, statePtr, 0x00, 0x00, 0x00],
    createCpuState({ eax: 0x1111_1111, ebx: 0x2222_2222, eip: startAddress }),
    { guest }
  );

  strictEqual(readStateU32(result.stateView, "eax"), 0x1111_1111);
  strictEqual(result.guestView.getUint32(statePtr, true), 0x2222_2222);
});

test("jit_guest_load_oob_fault_atomic", async () => {
  const guest = guestMemory();
  const initialState = createCpuState({
    eax: 0x1111_1111,
    eflags: 0xffff_0000,
    eip: startAddress,
    instructionCount: 7
  });
  const beforeGuest = readBytes(new DataView(guest.buffer), 0, 16);
  const result = await runCompiledBlock(
    [0x8b, 0x05, 0x00, 0x00, 0x01, 0x00],
    initialState,
    { guest }
  );

  deepStrictEqual(result.exit, {
    exitReason: ExitReason.MEMORY_FAULT,
    payload: 0x1_0000
  });
  assertStateEquals(result.stateView, initialState);
  deepStrictEqual(readBytes(result.guestView, 0, 16), beforeGuest);
});

test("jit_guest_store_oob_fault_atomic", async () => {
  const guest = guestMemory();
  const guestView = new DataView(guest.buffer);
  fillBytes(guestView, 0xfff8, 8, 0xaa);

  const initialState = createCpuState({
    eax: 0x1234_5678,
    eflags: 0xffff_0000,
    eip: startAddress,
    instructionCount: 7
  });
  const beforeGuest = readBytes(guestView, 0xfff8, 8);
  const result = await runCompiledBlock(
    [0x89, 0x05, 0xfe, 0xff, 0x00, 0x00],
    initialState,
    { guest }
  );

  deepStrictEqual(result.exit, {
    exitReason: ExitReason.MEMORY_FAULT,
    payload: 0xfffe
  });
  assertStateEquals(result.stateView, initialState);
  deepStrictEqual(readBytes(result.guestView, 0xfff8, 8), beforeGuest);
});

function guestMemory(): WebAssembly.Memory {
  return new WebAssembly.Memory({ initial: 1 });
}

function assertStateEquals(view: DataView, state: CpuState): void {
  for (const field of cpuStateFields) {
    strictEqual(readStateU32(view, field), state[field]);
  }
}

function fillBytes(view: DataView, address: number, length: number, value: number): void {
  for (let index = 0; index < length; index += 1) {
    view.setUint8(address + index, value);
  }
}

function readBytes(view: DataView, address: number, length: number): number[] {
  const bytes = [];

  for (let index = 0; index < length; index += 1) {
    bytes.push(view.getUint8(address + index));
  }

  return bytes;
}
