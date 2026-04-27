import type { DecodedInstruction, Operand } from "../arch/x86/instruction/types.js";
import { StopReason, type InstructionResult } from "../core/execution/stop-reason.js";
import { type CpuState, getReg32, setReg32, u32 } from "../core/state/cpu-state.js";

export function executeInstruction(state: CpuState, instruction: DecodedInstruction): InstructionResult {
  switch (instruction.mnemonic) {
    case "mov":
      return executeMov(state, instruction);
    case "nop":
      return completeInstruction(state, instruction);
    case "int":
      return executeInt(state, instruction);
    case "unsupported":
      return stop(state, StopReason.UNSUPPORTED);
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

function executeMov(state: CpuState, instruction: DecodedInstruction): InstructionResult {
  const destination = instruction.operands[0];
  const source = instruction.operands[1];

  if (destination?.kind !== "reg32" || source === undefined) {
    return stop(state, StopReason.UNSUPPORTED);
  }

  switch (source.kind) {
    case "imm32":
      setReg32(state, destination.reg, source.value);
      return completeInstruction(state, instruction);
    case "reg32":
      setReg32(state, destination.reg, getReg32(state, source.reg));
      return completeInstruction(state, instruction);
    case "imm8":
      return stop(state, StopReason.UNSUPPORTED);
  }
}

function executeInt(state: CpuState, instruction: DecodedInstruction): InstructionResult {
  const vector = intVector(instruction.operands[0]);

  if (vector === undefined) {
    return stop(state, StopReason.UNSUPPORTED);
  }

  advanceInstruction(state, instruction);
  state.stopReason = StopReason.HOST_TRAP;

  return {
    stopReason: StopReason.HOST_TRAP,
    eip: state.eip,
    trapVector: vector
  };
}

function completeInstruction(state: CpuState, instruction: DecodedInstruction): InstructionResult {
  advanceInstruction(state, instruction);
  return { stopReason: StopReason.NONE, eip: state.eip };
}

function stop(state: CpuState, reason: StopReason): InstructionResult {
  state.stopReason = reason;
  return { stopReason: reason, eip: state.eip };
}

function advanceInstruction(state: CpuState, instruction: DecodedInstruction): void {
  state.eip = u32(state.eip + instruction.length);
  state.instructionCount = u32(state.instructionCount + 1);
}

function intVector(operand: Operand | undefined): number | undefined {
  return operand?.kind === "imm8" ? operand.value : undefined;
}
