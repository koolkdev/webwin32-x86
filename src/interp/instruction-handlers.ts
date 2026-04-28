import { addFlags, logicalFlags, subFlags } from "../arch/x86/flags/arithmetic.js";
import { isJccConditionMet, type JccFlags } from "../arch/x86/flags/conditions.js";
import type { DecodedInstruction } from "../arch/x86/instruction/types.js";
import { runResultFromState, StopReason, type RunResult, type RunResultDetails } from "../core/execution/run-result.js";
import type { GuestMemory, MemoryFault } from "../core/memory/guest-memory.js";
import { type CpuState, getFlag, u32 } from "../core/state/cpu-state.js";
import {
  intVector,
  jumpTarget,
  type OperandWriteResult,
  readRegisterDestination,
  readOperandValue,
  registerDestination,
  sourceValue,
  writeFlags,
  writeOperandValue,
  writeRegisterDestination
} from "./operands.js";

export function executeMov(
  state: CpuState,
  instruction: DecodedInstruction,
  memory?: GuestMemory
): RunResult {
  return doOperandMutation(state, instruction, () =>
    copyMovValue(state, instruction, memory)
  );
}

export function executeNop(state: CpuState, instruction: DecodedInstruction): RunResult {
  return completeInstruction(state, instruction);
}

export function executeInt(state: CpuState, instruction: DecodedInstruction): RunResult {
  const vector = intVector(instruction.operands[0]);

  if (vector === undefined) {
    return stop(state, StopReason.UNSUPPORTED);
  }

  advanceInstruction(state, instruction);
  state.stopReason = StopReason.HOST_TRAP;

  return runResultFromState(state, StopReason.HOST_TRAP, { trapVector: vector });
}

export function executeJmp(state: CpuState, instruction: DecodedInstruction): RunResult {
  const target = jumpTarget(instruction.operands[0]);

  if (target === undefined) {
    return stop(state, StopReason.UNSUPPORTED);
  }

  return completeBranch(state, target);
}

export function executeJcc(state: CpuState, instruction: DecodedInstruction): RunResult {
  const target = jumpTarget(instruction.operands[0]);

  if (target === undefined || instruction.condition === undefined) {
    return stop(state, StopReason.UNSUPPORTED);
  }

  return isJccConditionMet(instruction.condition, readJccFlags(state))
    ? completeBranch(state, target)
    : completeInstruction(state, instruction);
}

export function executeAdd(state: CpuState, instruction: DecodedInstruction): RunResult {
  return executeArithmetic(state, instruction, "add");
}

export function executeSub(state: CpuState, instruction: DecodedInstruction): RunResult {
  return executeArithmetic(state, instruction, "sub");
}

export function executeXor(state: CpuState, instruction: DecodedInstruction): RunResult {
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

export function executeCmp(state: CpuState, instruction: DecodedInstruction): RunResult {
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

export function executeTest(state: CpuState, instruction: DecodedInstruction): RunResult {
  const destination = registerDestination(instruction);
  const right = sourceValue(state, instruction, { signExtendImm8: false });

  if (destination === undefined || right === undefined) {
    return stop(state, StopReason.UNSUPPORTED);
  }

  writeFlags(state, logicalFlags(readRegisterDestination(state, destination) & right));

  return completeInstruction(state, instruction);
}

export function executeUnsupported(state: CpuState, instruction: DecodedInstruction): RunResult {
  const byte = unsupportedByte(instruction);

  return stop(state, StopReason.UNSUPPORTED, unsupportedDetails(byte));
}

function executeArithmetic(
  state: CpuState,
  instruction: DecodedInstruction,
  operation: "add" | "sub"
): RunResult {
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

function completeInstruction(state: CpuState, instruction: DecodedInstruction): RunResult {
  advanceInstruction(state, instruction);
  return runResultFromState(state, StopReason.NONE);
}

function copyMovValue(
  state: CpuState,
  instruction: DecodedInstruction,
  memory: GuestMemory | undefined
): OperandWriteResult {
  const source = readOperandValue(state, instruction.operands[1], { memory });

  if (source.kind !== "value") {
    return source;
  }

  return writeOperandValue(state, instruction.operands[0], source.value, { memory });
}

function doOperandMutation(
  state: CpuState,
  instruction: DecodedInstruction,
  mutation: () => OperandWriteResult
): RunResult {
  const result = mutation();

  switch (result.kind) {
    case "ok":
      return completeInstruction(state, instruction);
    case "unsupported":
      return stop(state, StopReason.UNSUPPORTED);
    case "memoryFault":
      return stopMemoryFault(state, result.fault);
  }
}

function completeBranch(state: CpuState, target: number): RunResult {
  state.eip = u32(target);
  state.instructionCount = u32(state.instructionCount + 1);

  return runResultFromState(state, StopReason.NONE);
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

function stop(state: CpuState, reason: StopReason, details: RunResultDetails = {}): RunResult {
  state.stopReason = reason;
  return runResultFromState(state, reason, details);
}

function stopMemoryFault(state: CpuState, fault: MemoryFault): RunResult {
  return stop(state, StopReason.MEMORY_FAULT, fault);
}

function advanceInstruction(state: CpuState, instruction: DecodedInstruction): void {
  state.eip = u32(state.eip + instruction.length);
  state.instructionCount = u32(state.instructionCount + 1);
}

function unsupportedByte(instruction: DecodedInstruction): number | undefined {
  return instruction.raw[instruction.prefixes.length] ?? instruction.raw[0];
}

function unsupportedDetails(byte: number | undefined): RunResultDetails {
  if (byte === undefined) {
    return {};
  }

  return {
    unsupportedByte: byte,
    unsupportedReason: "unsupportedOpcode"
  };
}
