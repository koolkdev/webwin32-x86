import { strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import { StopReason, type RunResult } from "../src/core/execution/run-result.js";
import { createCpuState, type CpuState } from "../src/core/state/cpu-state.js";
import { runInstructionInterpreter } from "../src/interp/interpreter.js";

const startAddress = 0x1000;

test("jz_taken", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runBytes(state, [
    0x39, 0xc0,
    0x74, 0x05,
    0xbb, 0x01, 0x00, 0x00, 0x00,
    0xb9, 0x02, 0x00, 0x00, 0x00,
    0xcd, 0x2e
  ]);

  strictEqual(state.eip, 0x1010);
  strictEqual(state.ebx, 0);
  strictEqual(state.ecx, 2);
  strictEqual(state.instructionCount, 4);
  strictEqual(state.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
});

test("jz_not_taken", () => {
  const state = createCpuState({ eax: 2, eip: startAddress });
  const result = runBytes(state, [
    0x81, 0xf8, 0x01, 0x00, 0x00, 0x00,
    0x74, 0x05,
    0xbb, 0x01, 0x00, 0x00, 0x00,
    0xcd, 0x2e
  ]);

  strictEqual(state.eip, 0x100f);
  strictEqual(state.eax, 2);
  strictEqual(state.ebx, 1);
  strictEqual(state.instructionCount, 4);
  strictEqual(state.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
});

test("jnz_taken", () => {
  const state = createCpuState({ eax: 2, eip: startAddress });
  const result = runBytes(state, [
    0x81, 0xf8, 0x01, 0x00, 0x00, 0x00,
    0x0f, 0x85, 0x05, 0x00, 0x00, 0x00,
    0xbb, 0x01, 0x00, 0x00, 0x00,
    0xb9, 0x02, 0x00, 0x00, 0x00,
    0xcd, 0x2e
  ]);

  strictEqual(state.eip, 0x1018);
  strictEqual(state.ebx, 0);
  strictEqual(state.ecx, 2);
  strictEqual(state.instructionCount, 4);
  strictEqual(state.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
});

test("jl_signed_taken", () => {
  const state = createCpuState({ eax: 0xffff_ffff, eip: startAddress });
  const result = runBytes(state, [
    0x81, 0xf8, 0x01, 0x00, 0x00, 0x00,
    0x7c, 0x05,
    0xbb, 0x01, 0x00, 0x00, 0x00,
    0xb9, 0x02, 0x00, 0x00, 0x00,
    0xcd, 0x2e
  ]);

  strictEqual(state.eip, 0x1014);
  strictEqual(state.eax, 0xffff_ffff);
  strictEqual(state.ebx, 0);
  strictEqual(state.ecx, 2);
  strictEqual(state.instructionCount, 4);
  strictEqual(state.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
});

test("cmp_loop_counts_down", () => {
  const state = createCpuState({ eax: 3, eip: startAddress });
  const result = runBytes(state, [
    0x83, 0xe8, 0x01,
    0x83, 0xf8, 0x00,
    0x75, 0xf8,
    0xcd, 0x2e
  ]);

  strictEqual(state.eip, 0x100a);
  strictEqual(state.eax, 0);
  strictEqual(state.instructionCount, 10);
  strictEqual(state.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
});

function runBytes(state: CpuState, bytes: readonly number[]): RunResult {
  return runInstructionInterpreter(state, decodeBytes(bytes));
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
