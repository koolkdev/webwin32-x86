import { strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import { StopReason, type RunResult } from "../src/core/execution/run-result.js";
import { createCpuState, type CpuState } from "../src/core/state/cpu-state.js";
import { runInstructionInterpreter, type InterpreterRunOptions } from "../src/interp/interpreter.js";

const startAddress = 0x1000;

test("jmp_forward", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runBytes(state, [0xeb, 0x02, 0x90, 0x90, 0xcd, 0x2e]);

  strictEqual(state.eip, 0x1006);
  strictEqual(state.instructionCount, 2);
  strictEqual(state.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.trapVector, 0x2e);
});

test("jmp_backward_with_limit", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runBytes(state, [0xeb, 0xfe], { instructionLimit: 3 });

  strictEqual(state.eip, startAddress);
  strictEqual(state.instructionCount, 3);
  strictEqual(state.stopReason, StopReason.INSTRUCTION_LIMIT);
  strictEqual(result.stopReason, StopReason.INSTRUCTION_LIMIT);
  strictEqual(result.finalEip, state.eip);
});

test("jmp_rel32_backward", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runBytes(state, [0x90, 0xe9, 0xfa, 0xff, 0xff, 0xff], { instructionLimit: 2 });

  strictEqual(state.eip, startAddress);
  strictEqual(state.instructionCount, 2);
  strictEqual(result.stopReason, StopReason.INSTRUCTION_LIMIT);
  strictEqual(result.finalEip, state.eip);
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
