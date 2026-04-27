import type { DecodedInstruction, Operand, Reg32 } from "../arch/x86/instruction/types.js";
import { applyAddFlags, applySubFlags } from "../arch/x86/flags/arithmetic.js";
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
    case "add":
      return executeArithmetic(state, instruction, "add");
    case "sub":
      return executeArithmetic(state, instruction, "sub");
    case "xor":
    case "cmp":
    case "test":
      return stop(state, StopReason.UNSUPPORTED);
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
  const destination = registerDestination(instruction);
  const source = sourceValue(state, instruction, { signExtendImm8: false });

  if (destination === undefined || source === undefined) {
    return stop(state, StopReason.UNSUPPORTED);
  }

  writeRegisterDestination(state, destination, source);
  return completeInstruction(state, instruction);
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

  if (operation === "add") {
    applyAddFlags(state, left, right, result);
  } else {
    applySubFlags(state, left, right, result);
  }

  return completeInstruction(state, instruction);
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

type RegisterDestination = Readonly<{
  reg: Reg32;
}>;

function registerDestination(instruction: DecodedInstruction): RegisterDestination | undefined {
  const operand = instruction.operands[0];

  return operand?.kind === "reg32" ? { reg: operand.reg } : undefined;
}

function readRegisterDestination(state: CpuState, destination: RegisterDestination): number {
  return getReg32(state, destination.reg);
}

function writeRegisterDestination(state: CpuState, destination: RegisterDestination, value: number): void {
  setReg32(state, destination.reg, value);
}

function sourceValue(
  state: CpuState,
  instruction: DecodedInstruction,
  options: Readonly<{ signExtendImm8: boolean }>
): number | undefined {
  const operand = instruction.operands[1];

  if (operand === undefined) {
    return undefined;
  }

  switch (operand.kind) {
    case "reg32":
      return getReg32(state, operand.reg);
    case "imm32":
      return operand.value;
    case "imm8":
      return options.signExtendImm8 ? u32(operand.signedValue) : undefined;
  }
}
