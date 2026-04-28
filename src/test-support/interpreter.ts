import { strictEqual } from "node:assert";

import { StopReason } from "../core/execution/run-result.js";
import type { RunResult } from "../core/execution/run-result.js";
import type { CpuState } from "../core/state/cpu-state.js";
import {
  executeInstruction,
  runInstructionInterpreter,
  type InterpreterRunOptions
} from "../interp/interpreter.js";
import { decodeBytes, startAddress } from "./x86-code.js";

export { decodeBytes, startAddress };

export function runBytes(
  state: CpuState,
  bytes: readonly number[],
  options: InterpreterRunOptions = {}
): RunResult {
  return runInstructionInterpreter(state, decodeBytes(bytes), options);
}

export function executeBytes(state: CpuState, bytes: readonly number[]): void {
  const instruction = decodeBytes(bytes, state.eip)[0];

  if (instruction === undefined) {
    throw new Error("expected decoded instruction");
  }

  const result = executeInstruction(state, instruction);

  strictEqual(result.stopReason, StopReason.NONE);
}
