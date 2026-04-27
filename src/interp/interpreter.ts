import type { DecodedInstruction } from "../arch/x86/instruction/types.js";
import { StopReason, type InstructionResult } from "../core/execution/stop-reason.js";
import type { CpuState } from "../core/state/cpu-state.js";
import {
  executeAdd,
  executeCmp,
  executeInt,
  executeMov,
  executeNop,
  executeSub,
  executeTest,
  executeUnsupported,
  executeXor
} from "./instruction-handlers.js";

export function executeInstruction(state: CpuState, instruction: DecodedInstruction): InstructionResult {
  switch (instruction.mnemonic) {
    case "mov":
      return executeMov(state, instruction);
    case "nop":
      return executeNop(state, instruction);
    case "int":
      return executeInt(state, instruction);
    case "add":
      return executeAdd(state, instruction);
    case "sub":
      return executeSub(state, instruction);
    case "xor":
      return executeXor(state, instruction);
    case "cmp":
      return executeCmp(state, instruction);
    case "test":
      return executeTest(state, instruction);
    case "jmp":
    case "unsupported":
      return executeUnsupported(state);
  }
}

export function runInstructionInterpreter(
  state: CpuState,
  instructions: readonly DecodedInstruction[]
): InstructionResult {
  let result: InstructionResult = { stopReason: StopReason.NONE, eip: state.eip };

  for (const instruction of instructions) {
    result = executeInstruction(state, instruction);

    if (result.stopReason !== StopReason.NONE) {
      return result;
    }
  }

  return result;
}
