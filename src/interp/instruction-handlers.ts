import { isJccConditionMet, type JccFlags } from "../arch/x86/flags/conditions.js";
import type { DecodedInstruction } from "../arch/x86/instruction/types.js";
import { runResultFromState, StopReason, type RunResult, type RunResultDetails } from "../core/execution/run-result.js";
import type { GuestMemory } from "../core/memory/guest-memory.js";
import { type CpuState, getFlag, u32 } from "../core/state/cpu-state.js";
import {
  addressExpressionValue,
  intVector,
  jumpTarget,
  type OperandWriteResult,
  readOperandValue,
  writeOperandValue
} from "./operands.js";
import { runMutation } from "./mutation.js";

export function executeMov(
  state: CpuState,
  instruction: DecodedInstruction,
  memory?: GuestMemory
): RunResult {
  return runMutation(state, instruction, () =>
    copyMovValue(state, instruction, memory)
  );
}

export function executeLea(state: CpuState, instruction: DecodedInstruction): RunResult {
  return runMutation(state, instruction, () => writeLeaValue(state, instruction));
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

export function executeUnsupported(state: CpuState, instruction: DecodedInstruction): RunResult {
  const byte = unsupportedByte(instruction);

  return stop(state, StopReason.UNSUPPORTED, unsupportedDetails(byte));
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

function writeLeaValue(state: CpuState, instruction: DecodedInstruction): OperandWriteResult {
  const address = addressExpressionValue(state, instruction.operands[1]);

  if (address.kind !== "value") {
    return address;
  }

  return writeOperandValue(state, instruction.operands[0], address.value);
}

function completeInstruction(state: CpuState, instruction: DecodedInstruction): RunResult {
  advanceInstruction(state, instruction);
  return runResultFromState(state, StopReason.NONE);
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
