import type { DecodedInstruction } from "../arch/x86/instruction/types.js";
import { runResultFromState, StopReason, type RunResult } from "../core/execution/run-result.js";
import type { GuestMemory } from "../core/memory/guest-memory.js";
import type { CpuState } from "../core/state/cpu-state.js";
import {
  executeAdd,
  executeCmp,
  executeSub,
  executeTest,
  executeXor
} from "./alu.js";
import {
  executeCall,
  executeRet
} from "./call-return.js";
import {
  executeInt,
  executeJcc,
  executeJmp,
  executeLea,
  executeMov,
  executeNop,
  executeUnsupported
} from "./instruction-handlers.js";
import {
  executePop,
  executePush
} from "./stack.js";

const defaultInstructionLimit = 10_000;

export type InterpreterRunOptions = Readonly<{
  instructionLimit?: number;
  memory?: GuestMemory;
}>;

export type ExecuteInstructionOptions = Readonly<{
  memory?: GuestMemory;
}>;

export function executeInstruction(
  state: CpuState,
  instruction: DecodedInstruction,
  options: ExecuteInstructionOptions = {}
): RunResult {
  switch (instruction.mnemonic) {
    case "mov":
      return executeMov(state, instruction, options.memory);
    case "nop":
      return executeNop(state, instruction);
    case "int":
      return executeInt(state, instruction);
    case "add":
      return executeAdd(state, instruction, options.memory);
    case "sub":
      return executeSub(state, instruction, options.memory);
    case "xor":
      return executeXor(state, instruction, options.memory);
    case "cmp":
      return executeCmp(state, instruction, options.memory);
    case "test":
      return executeTest(state, instruction, options.memory);
    case "jmp":
      return executeJmp(state, instruction);
    case "jcc":
      return executeJcc(state, instruction);
    case "lea":
      return executeLea(state, instruction);
    case "push":
      return executePush(state, instruction, options.memory);
    case "pop":
      return executePop(state, instruction, options.memory);
    case "call":
      return executeCall(state, instruction, options.memory);
    case "ret":
      return executeRet(state, instruction, options.memory);
    case "unsupported":
      return executeUnsupported(state, instruction);
  }
}

export function runInstructionInterpreter(
  state: CpuState,
  instructions: readonly DecodedInstruction[],
  options: InterpreterRunOptions = {}
): RunResult {
  let result = runResultFromState(state, StopReason.NONE);
  const instructionByAddress = new Map(instructions.map((instruction) => [instruction.address, instruction]));
  const instructionLimit = options.instructionLimit ?? defaultInstructionLimit;

  for (let executed = 0; executed < instructionLimit; executed += 1) {
    const instruction = instructionByAddress.get(state.eip);

    if (instruction === undefined) {
      return result;
    }

    result =
      options.memory === undefined
        ? executeInstruction(state, instruction)
        : executeInstruction(state, instruction, { memory: options.memory });

    if (result.stopReason !== StopReason.NONE) {
      return result;
    }
  }

  state.stopReason = StopReason.INSTRUCTION_LIMIT;
  return runResultFromState(state, StopReason.INSTRUCTION_LIMIT);
}
