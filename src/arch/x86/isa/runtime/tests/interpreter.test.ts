import { strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason } from "../../../../../core/execution/run-result.js";
import { cloneCpuState, cpuStatesEqual, createCpuState, getFlag } from "../../../../../core/state/cpu-state.js";
import { runInstructionInterpreter } from "../../../../../interp/interpreter.js";
import { decodeBytes } from "../../../../../test-support/x86-code.js";
import { runIsaInterpreter } from "../interpreter.js";
import { bytes, startAddress } from "./helpers.js";

test("matches the handwritten interpreter for register control flow", () => {
  const program = [
    0xb8, 0x03, 0x00, 0x00, 0x00, // mov eax, 3
    0x83, 0xe8, 0x01, // sub eax, 1
    0x75, 0xfb // jnz -5
  ];
  const initialState = createCpuState({ eip: startAddress, eflags: 0xffff_0000 });
  const isaState = cloneCpuState(initialState);
  const handwrittenState = cloneCpuState(initialState);

  const isaResult = runIsaInterpreter(isaState, bytes(program), { baseAddress: startAddress });
  const handwrittenResult = runInstructionInterpreter(handwrittenState, decodeBytes(program));

  strictEqual(cpuStatesEqual(isaState, handwrittenState), true);
  strictEqual(isaResult.stopReason, handwrittenResult.stopReason);
  strictEqual(isaResult.finalEip, startAddress + program.length);
  strictEqual(isaResult.instructionCount, 7);
});

test("executes spec-only immediate logical forms", () => {
  const state = createCpuState({ eip: startAddress, eflags: 0xffff_0000 });
  const program = bytes([
    0xb8, 0xff, 0xff, 0xff, 0xff, // mov eax, 0xffffffff
    0x35, 0xff, 0xff, 0xff, 0xff, // xor eax, 0xffffffff
    0xa9, 0xff, 0xff, 0xff, 0xff // test eax, 0xffffffff
  ]);

  const result = runIsaInterpreter(state, program, { baseAddress: startAddress });

  strictEqual(result.stopReason, StopReason.NONE);
  strictEqual(state.eax, 0);
  strictEqual(state.eip, startAddress + program.length);
  strictEqual(state.instructionCount, 3);
  strictEqual(getFlag(state, "ZF"), true);
  strictEqual(getFlag(state, "CF"), false);
  strictEqual(getFlag(state, "OF"), false);
});

test("stops on unsupported opcodes", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runIsaInterpreter(state, bytes([0x62]), { baseAddress: startAddress });

  strictEqual(result.stopReason, StopReason.UNSUPPORTED);
  strictEqual(result.unsupportedByte, 0x62);
  strictEqual(state.eip, startAddress);
  strictEqual(state.instructionCount, 0);
});

test("honors instruction limit", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runIsaInterpreter(state, bytes([0xeb, 0xfe]), {
    baseAddress: startAddress,
    instructionLimit: 3
  });

  strictEqual(result.stopReason, StopReason.INSTRUCTION_LIMIT);
  strictEqual(state.eip, startAddress);
  strictEqual(state.instructionCount, 3);
});
