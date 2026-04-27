import type { DecodedInstruction } from "../arch/x86/instruction/types.js";
import { StopReason, type InstructionResult } from "../core/execution/stop-reason.js";
import type { CpuState } from "../core/state/cpu-state.js";
import {
  executeAdd,
  executeCmp,
  executeInt,
  executeJcc,
  executeJmp,
  executeMov,
  executeNop,
  executeSub,
  executeTest,
  executeUnsupported,
  executeXor
} from "./instruction-handlers.js";

const defaultInstructionLimit = 10_000;

export type InterpreterRunOptions = Readonly<{
  instructionLimit?: number;
}>;

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
      return executeJmp(state, instruction);
    case "jcc":
      return executeJcc(state, instruction);
    case "unsupported":
      return executeUnsupported(state);
  }
}

export function runInstructionInterpreter(
  state: CpuState,
  instructions: readonly DecodedInstruction[],
  options: InterpreterRunOptions = {}
): InstructionResult {
  let result: InstructionResult = { stopReason: StopReason.NONE, eip: state.eip };
  const instructionByAddress = new Map(instructions.map((instruction) => [instruction.address, instruction]));
  const instructionLimit = options.instructionLimit ?? defaultInstructionLimit;

  for (let executed = 0; executed < instructionLimit; executed += 1) {
    const instruction = instructionByAddress.get(state.eip);

    if (instruction === undefined) {
      return result;
    }

    result = executeInstruction(state, instruction);

    if (result.stopReason !== StopReason.NONE) {
      return result;
    }
  }

  state.stopReason = StopReason.INSTRUCTION_LIMIT;
  return { stopReason: StopReason.INSTRUCTION_LIMIT, eip: state.eip };
}
