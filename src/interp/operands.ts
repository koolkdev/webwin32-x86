import type { FlagValues } from "../arch/x86/flags/arithmetic.js";
import type { DecodedInstruction, Operand, Reg32 } from "../arch/x86/instruction/types.js";
import { type CpuState, getReg32, setFlag, setReg32, u32 } from "../core/state/cpu-state.js";

export type RegisterDestination = Readonly<{
  reg: Reg32;
}>;

export function registerDestination(instruction: DecodedInstruction): RegisterDestination | undefined {
  const operand = instruction.operands[0];

  return operand?.kind === "reg32" ? { reg: operand.reg } : undefined;
}

export function readRegisterDestination(state: CpuState, destination: RegisterDestination): number {
  return getReg32(state, destination.reg);
}

export function writeRegisterDestination(state: CpuState, destination: RegisterDestination, value: number): void {
  setReg32(state, destination.reg, value);
}

export function sourceValue(
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
    case "rel8":
    case "rel32":
      return undefined;
  }
}

export function intVector(operand: Operand | undefined): number | undefined {
  return operand?.kind === "imm8" ? operand.value : undefined;
}

export function jumpTarget(operand: Operand | undefined): number | undefined {
  return operand?.kind === "rel8" || operand?.kind === "rel32" ? operand.target : undefined;
}

export function writeFlags(state: CpuState, flags: FlagValues): void {
  setFlag(state, "CF", flags.CF);
  setFlag(state, "PF", flags.PF);
  setFlag(state, "AF", flags.AF);
  setFlag(state, "ZF", flags.ZF);
  setFlag(state, "SF", flags.SF);
  setFlag(state, "OF", flags.OF);
}
