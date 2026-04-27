import { addFlags, logicalFlags, subFlags } from "../arch/x86/flags/arithmetic.js";
import { isJccConditionMet, type JccFlags } from "../arch/x86/flags/conditions.js";
import type { DecodedInstruction } from "../arch/x86/instruction/types.js";
import { StopReason, type InstructionResult } from "../core/execution/stop-reason.js";
import { type CpuState, getFlag, u32 } from "../core/state/cpu-state.js";
import {
  intVector,
  jumpTarget,
  readRegisterDestination,
  registerDestination,
  sourceValue,
  writeFlags,
  writeRegisterDestination
} from "./operands.js";

export function executeMov(state: CpuState, instruction: DecodedInstruction): InstructionResult {
  const destination = registerDestination(instruction);
  const source = sourceValue(state, instruction, { signExtendImm8: false });

  if (destination === undefined || source === undefined) {
    return stop(state, StopReason.UNSUPPORTED);
  }

  writeRegisterDestination(state, destination, source);
  return completeInstruction(state, instruction);
}

export function executeNop(state: CpuState, instruction: DecodedInstruction): InstructionResult {
  return completeInstruction(state, instruction);
}

export function executeInt(state: CpuState, instruction: DecodedInstruction): InstructionResult {
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

export function executeJmp(state: CpuState, instruction: DecodedInstruction): InstructionResult {
  const target = jumpTarget(instruction.operands[0]);

  if (target === undefined) {
    return stop(state, StopReason.UNSUPPORTED);
  }

  return completeBranch(state, target);
}

export function executeJcc(state: CpuState, instruction: DecodedInstruction): InstructionResult {
  const target = jumpTarget(instruction.operands[0]);

  if (target === undefined || instruction.condition === undefined) {
    return stop(state, StopReason.UNSUPPORTED);
  }

  return isJccConditionMet(instruction.condition, readJccFlags(state))
    ? completeBranch(state, target)
    : completeInstruction(state, instruction);
}

export function executeAdd(state: CpuState, instruction: DecodedInstruction): InstructionResult {
  return executeArithmetic(state, instruction, "add");
}

export function executeSub(state: CpuState, instruction: DecodedInstruction): InstructionResult {
  return executeArithmetic(state, instruction, "sub");
}

export function executeXor(state: CpuState, instruction: DecodedInstruction): InstructionResult {
  const destination = registerDestination(instruction);
  const right = sourceValue(state, instruction, { signExtendImm8: false });

  if (destination === undefined || right === undefined) {
    return stop(state, StopReason.UNSUPPORTED);
  }

  const result = u32(readRegisterDestination(state, destination) ^ right);

  writeRegisterDestination(state, destination, result);
  writeFlags(state, logicalFlags(result));

  return completeInstruction(state, instruction);
}

export function executeCmp(state: CpuState, instruction: DecodedInstruction): InstructionResult {
  const destination = registerDestination(instruction);
  const right = sourceValue(state, instruction, { signExtendImm8: true });

  if (destination === undefined || right === undefined) {
    return stop(state, StopReason.UNSUPPORTED);
  }

  const left = readRegisterDestination(state, destination);
  const result = u32(left - right);

  writeFlags(state, subFlags(left, right, result));

  return completeInstruction(state, instruction);
}

export function executeTest(state: CpuState, instruction: DecodedInstruction): InstructionResult {
  const destination = registerDestination(instruction);
  const right = sourceValue(state, instruction, { signExtendImm8: false });

  if (destination === undefined || right === undefined) {
    return stop(state, StopReason.UNSUPPORTED);
  }

  writeFlags(state, logicalFlags(readRegisterDestination(state, destination) & right));

  return completeInstruction(state, instruction);
}

export function executeUnsupported(state: CpuState): InstructionResult {
  return stop(state, StopReason.UNSUPPORTED);
}

function executeArithmetic(
  state: CpuState,
  instruction: DecodedInstruction,
  operation: "add" | "sub"
): InstructionResult {
  const destination = registerDestination(instruction);
  const right = sourceValue(state, instruction, { signExtendImm8: true });

  if (destination === undefined || right === undefined) {
    return stop(state, StopReason.UNSUPPORTED);
  }

  const left = readRegisterDestination(state, destination);
  const result = operation === "add" ? u32(left + right) : u32(left - right);

  writeRegisterDestination(state, destination, result);
  writeFlags(state, operation === "add" ? addFlags(left, right, result) : subFlags(left, right, result));

  return completeInstruction(state, instruction);
}

function completeInstruction(state: CpuState, instruction: DecodedInstruction): InstructionResult {
  advanceInstruction(state, instruction);
  return { stopReason: StopReason.NONE, eip: state.eip };
}

function completeBranch(state: CpuState, target: number): InstructionResult {
  state.eip = u32(target);
  state.instructionCount = u32(state.instructionCount + 1);

  return { stopReason: StopReason.NONE, eip: state.eip };
}

function readJccFlags(state: CpuState): JccFlags {
  return {
    CF: getFlag(state, "CF"),
    PF: getFlag(state, "PF"),
    ZF: getFlag(state, "ZF"),
    SF: getFlag(state, "SF"),
    OF: getFlag(state, "OF")
  };
}

function stop(state: CpuState, reason: StopReason): InstructionResult {
  state.stopReason = reason;
  return { stopReason: reason, eip: state.eip };
}

function advanceInstruction(state: CpuState, instruction: DecodedInstruction): void {
  state.eip = u32(state.eip + instruction.length);
  state.instructionCount = u32(state.instructionCount + 1);
}
