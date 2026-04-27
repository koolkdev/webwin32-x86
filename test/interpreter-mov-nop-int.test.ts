import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import { StopReason, type InstructionResult } from "../src/core/execution/stop-reason.js";
import { createCpuState, type CpuState } from "../src/core/state/cpu-state.js";
import { runInstructionInterpreter } from "../src/interp/interpreter.js";

const startAddress = 0x1000;

test("executes mov immediate then int host trap", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runBytes(state, [0xb8, 0x78, 0x56, 0x34, 0x12, 0xcd, 0x2e]);

  strictEqual(state.eax, 0x1234_5678);
  strictEqual(state.eip, 0x1007);
  strictEqual(state.instructionCount, 2);
  strictEqual(state.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.eip, state.eip);
  strictEqual(result.trapVector, 0x2e);
});

test("executes register mov then int host trap", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runBytes(state, [0xb8, 0x01, 0x00, 0x00, 0x00, 0x89, 0xc1, 0xcd, 0x2e]);

  strictEqual(state.eax, 1);
  strictEqual(state.ecx, 1);
  strictEqual(state.eip, 0x1009);
  strictEqual(state.instructionCount, 3);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.eip, state.eip);
});

test("executes nop then int host trap", () => {
  const state = createCpuState({ eip: startAddress });
  const beforeRegisters = {
    eax: state.eax,
    ecx: state.ecx,
    edx: state.edx,
    ebx: state.ebx,
    esp: state.esp,
    ebp: state.ebp,
    esi: state.esi,
    edi: state.edi
  };
  const result = runBytes(state, [0x90, 0xcd, 0x2e]);

  deepStrictEqual(
    {
      eax: state.eax,
      ecx: state.ecx,
      edx: state.edx,
      ebx: state.ebx,
      esp: state.esp,
      ebp: state.ebp,
      esi: state.esi,
      edi: state.edi
    },
    beforeRegisters
  );
  strictEqual(state.eip, 0x1003);
  strictEqual(state.instructionCount, 2);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.eip, state.eip);
});

test("unsupported instruction stops without advancing eip or count", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runBytes(state, [0x62]);

  strictEqual(state.eip, startAddress);
  strictEqual(state.instructionCount, 0);
  strictEqual(state.stopReason, StopReason.UNSUPPORTED);
  strictEqual(result.stopReason, StopReason.UNSUPPORTED);
  strictEqual(result.eip, state.eip);
});

function runBytes(state: CpuState, bytes: readonly number[]): InstructionResult {
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
