import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason } from "../../../../../core/execution/run-result.js";
import { ArrayBufferGuestMemory } from "../../../../../core/memory/guest-memory.js";
import { createCpuState, getFlag, setFlag } from "../../../../../core/state/cpu-state.js";
import { decodeIsaInstruction } from "../../decoder/decode.js";
import { executeIsaInstruction } from "../execute.js";
import { bytes, ok, startAddress } from "./helpers.js";

test("executes mov r32, imm32", () => {
  const state = createCpuState({ eip: startAddress });
  const result = execute(state, [0xbb, 0x78, 0x56, 0x34, 0x12]);

  strictEqual(result.stopReason, StopReason.NONE);
  strictEqual(state.ebx, 0x1234_5678);
  strictEqual(state.eip, startAddress + 5);
  strictEqual(state.instructionCount, 1);
});

test("executes register mov in both ModRM directions", () => {
  const state = createCpuState({ eax: 0x1111_1111, ebx: 0x2222_2222, eip: startAddress });

  execute(state, [0x8b, 0xc3]);
  strictEqual(state.eax, 0x2222_2222);

  executeAtStateEip(state, [0x89, 0xc3]);
  strictEqual(state.ebx, 0x2222_2222);
  strictEqual(state.instructionCount, 2);
});

test("executes add r/m32, r32 and materializes add flags", () => {
  const state = createCpuState({ eax: 0xffff_ffff, ebx: 1, eip: startAddress });

  execute(state, [0x01, 0xd8]);

  strictEqual(state.eax, 0);
  strictEqual(getFlag(state, "CF"), true);
  strictEqual(getFlag(state, "ZF"), true);
  strictEqual(getFlag(state, "SF"), false);
  strictEqual(getFlag(state, "OF"), false);
});

test("executes add eax, imm32", () => {
  const state = createCpuState({ eax: 0x7fff_ffff, eip: startAddress });

  execute(state, [0x05, 0x01, 0x00, 0x00, 0x00]);

  strictEqual(state.eax, 0x8000_0000);
  strictEqual(getFlag(state, "OF"), true);
  strictEqual(getFlag(state, "SF"), true);
});

test("executes sub r/m32, sign-extended imm8", () => {
  const state = createCpuState({ ebx: 0, eip: startAddress });

  execute(state, [0x83, 0xeb, 0xff]);

  strictEqual(state.ebx, 1);
  strictEqual(getFlag(state, "CF"), true);
});

test("executes xor eax, imm32 and clears logical carry/overflow", () => {
  const state = createCpuState({ eax: 0xffff_ffff, eflags: 0xffff_ffff, eip: startAddress });

  execute(state, [0x35, 0xff, 0xff, 0xff, 0xff]);

  strictEqual(state.eax, 0);
  strictEqual(getFlag(state, "ZF"), true);
  strictEqual(getFlag(state, "CF"), false);
  strictEqual(getFlag(state, "OF"), false);
  strictEqual(getFlag(state, "AF"), false);
});

test("executes cmp without writing operands", () => {
  const state = createCpuState({ eax: 5, ebx: 5, eip: startAddress });

  execute(state, [0x39, 0xd8]);

  strictEqual(state.eax, 5);
  strictEqual(state.ebx, 5);
  strictEqual(getFlag(state, "ZF"), true);
  strictEqual(getFlag(state, "CF"), false);
});

test("executes test without writing operands", () => {
  const state = createCpuState({ eax: 0x80, ebx: 0xff, eip: startAddress });

  execute(state, [0x85, 0xd8]);

  strictEqual(state.eax, 0x80);
  strictEqual(state.ebx, 0xff);
  strictEqual(getFlag(state, "ZF"), false);
  strictEqual(getFlag(state, "SF"), false);
  strictEqual(getFlag(state, "CF"), false);
});

test("executes memory mov load and store", () => {
  const memory = new ArrayBufferGuestMemory(0x40);
  const state = createCpuState({ eax: 0xaabb_ccdd, ebx: 0x10, eip: startAddress });

  execute(state, [0x89, 0x43, 0x04], memory);
  deepStrictEqual(memory.readU32(0x14), { ok: true, value: 0xaabb_ccdd });

  state.eax = 0;
  executeAtStateEip(state, [0x8b, 0x43, 0x04], memory);
  strictEqual(state.eax, 0xaabb_ccdd);
});

test("executes lea without reading memory", () => {
  const state = createCpuState({ ebx: 0x20, eip: startAddress });

  execute(state, [0x8d, 0x43, 0x04]);

  strictEqual(state.eax, 0x24);
});

test("executes direct jumps", () => {
  const state = createCpuState({ eip: startAddress });

  execute(state, [0xeb, 0x05]);
  strictEqual(state.eip, startAddress + 7);

  executeAtAddress(state, startAddress, [0xe9, 0xfb, 0xff, 0xff, 0xff]);
  strictEqual(state.eip, startAddress);
});

test("executes conditional jump taken and not taken", () => {
  const notTaken = createCpuState({ eip: startAddress });
  const taken = createCpuState({ eip: startAddress });

  setFlag(notTaken, "ZF", true);
  execute(notTaken, [0x75, 0x05]);
  strictEqual(notTaken.eip, startAddress + 2);

  execute(taken, [0x83, 0xe8, 0x01]);
  executeAtStateEip(taken, [0x75, 0x05]);
  strictEqual(taken.eip, startAddress + 10);
});

test("executes int imm8 as a host trap", () => {
  const state = createCpuState({ eip: startAddress });
  const result = execute(state, [0xcd, 0x2e]);

  strictEqual(result.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.trapVector, 0x2e);
  strictEqual(state.eip, startAddress + 2);
  strictEqual(state.instructionCount, 1);
  strictEqual(state.stopReason, StopReason.HOST_TRAP);
});

function execute(state: ReturnType<typeof createCpuState>, values: readonly number[], memory?: ArrayBufferGuestMemory) {
  return executeAtAddress(state, startAddress, values, memory);
}

function executeAtStateEip(state: ReturnType<typeof createCpuState>, values: readonly number[], memory?: ArrayBufferGuestMemory) {
  return executeAtAddress(state, state.eip, values, memory);
}

function executeAtAddress(
  state: ReturnType<typeof createCpuState>,
  address: number,
  values: readonly number[],
  memory?: ArrayBufferGuestMemory
) {
  const decoded = ok(decodeIsaInstruction(bytes(values), 0, address));

  state.eip = address;
  return memory === undefined
    ? executeIsaInstruction(state, decoded)
    : executeIsaInstruction(state, decoded, { memory });
}
