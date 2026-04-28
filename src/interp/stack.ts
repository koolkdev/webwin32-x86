import type { DecodedInstruction, Operand } from "../arch/x86/instruction/types.js";
import type { RunResult } from "../core/execution/run-result.js";
import type { GuestMemory } from "../core/memory/guest-memory.js";
import { type CpuState, getReg32, setReg32, u32 } from "../core/state/cpu-state.js";
import { runMutation, type MutationResult } from "./mutation.js";

export function executePush(
  state: CpuState,
  instruction: DecodedInstruction,
  memory?: GuestMemory
): RunResult {
  return runMutation(state, instruction, () => pushValue(state, instruction.operands[0], memory));
}

export function executePop(
  state: CpuState,
  instruction: DecodedInstruction,
  memory?: GuestMemory
): RunResult {
  return runMutation(state, instruction, () => popValue(state, instruction.operands[0], memory));
}

function pushValue(
  state: CpuState,
  operand: Operand | undefined,
  memory: GuestMemory | undefined
): MutationResult {
  if (memory === undefined) {
    return { kind: "unsupported" };
  }

  const value = pushOperandValue(state, operand);

  if (value === undefined) {
    return { kind: "unsupported" };
  }

  const nextEsp = u32(state.esp - 4);
  const write = memory.writeU32(nextEsp, value);

  if (!write.ok) {
    return { kind: "memoryFault", fault: write.fault };
  }

  state.esp = nextEsp;

  return { kind: "ok" };
}

function popValue(
  state: CpuState,
  operand: Operand | undefined,
  memory: GuestMemory | undefined
): MutationResult {
  if (memory === undefined || operand?.kind !== "reg32") {
    return { kind: "unsupported" };
  }

  const read = memory.readU32(state.esp);

  if (!read.ok) {
    return { kind: "memoryFault", fault: read.fault };
  }

  setReg32(state, operand.reg, read.value);
  state.esp = u32(state.esp + 4);

  return { kind: "ok" };
}

function pushOperandValue(state: CpuState, operand: Operand | undefined): number | undefined {
  switch (operand?.kind) {
    case "reg32":
      return getReg32(state, operand.reg);
    case "imm32":
      return operand.value;
    case "imm8":
      return u32(operand.signedValue);
    default:
      return undefined;
  }
}
