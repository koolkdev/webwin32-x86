import type { FlagValues } from "../arch/x86/flags/arithmetic.js";
import type { DecodedInstruction, Mem32Operand, Operand, Reg32 } from "../arch/x86/instruction/types.js";
import type { GuestMemory, MemoryFault } from "../core/memory/guest-memory.js";
import { type CpuState, getReg32, setFlag, setReg32, u32 } from "../core/state/cpu-state.js";

export type RegisterDestination = Readonly<{
  reg: Reg32;
}>;

export type OperandReadResult =
  | Readonly<{ kind: "value"; value: number }>
  | Readonly<{ kind: "unsupported" }>
  | Readonly<{ kind: "memoryFault"; fault: MemoryFault }>;

export type OperandWriteResult =
  | Readonly<{ kind: "ok" }>
  | Readonly<{ kind: "unsupported" }>
  | Readonly<{ kind: "memoryFault"; fault: MemoryFault }>;

export type OperandAccessOptions = Readonly<{
  memory?: GuestMemory | undefined;
  signExtendImm8?: boolean;
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

export function effectiveAddress(state: CpuState, operand: Mem32Operand): number {
  const base = operand.base === undefined ? 0 : getReg32(state, operand.base);
  const index = operand.index === undefined ? 0 : u32(getReg32(state, operand.index) * operand.scale);

  return u32(base + index + operand.disp);
}

export function addressExpressionValue(state: CpuState, operand: Operand | undefined): OperandReadResult {
  return operand?.kind === "mem32"
    ? { kind: "value", value: effectiveAddress(state, operand) }
    : { kind: "unsupported" };
}

export function readOperandValue(
  state: CpuState,
  operand: Operand | undefined,
  options: OperandAccessOptions = {}
): OperandReadResult {
  if (operand === undefined) {
    return { kind: "unsupported" };
  }

  switch (operand.kind) {
    case "reg32":
      return { kind: "value", value: getReg32(state, operand.reg) };
    case "imm32":
      return { kind: "value", value: operand.value };
    case "imm8":
      return options.signExtendImm8 === true
        ? { kind: "value", value: u32(operand.signedValue) }
        : { kind: "unsupported" };
    case "mem32":
      return readMemoryOperand(state, operand, options.memory);
    case "imm16":
    case "rel8":
    case "rel32":
      return { kind: "unsupported" };
  }
}

export function writeOperandValue(
  state: CpuState,
  operand: Operand | undefined,
  value: number,
  options: OperandAccessOptions = {}
): OperandWriteResult {
  if (operand === undefined) {
    return { kind: "unsupported" };
  }

  switch (operand.kind) {
    case "reg32":
      setReg32(state, operand.reg, value);
      return { kind: "ok" };
    case "mem32":
      return writeMemoryOperand(state, operand, value, options.memory);
    case "imm8":
    case "imm16":
    case "imm32":
    case "rel8":
    case "rel32":
      return { kind: "unsupported" };
  }
}

export function sourceValue(
  state: CpuState,
  instruction: DecodedInstruction,
  options: Readonly<{ signExtendImm8: boolean }>
): number | undefined {
  const result = readOperandValue(state, instruction.operands[1], { signExtendImm8: options.signExtendImm8 });

  return result.kind === "value" ? result.value : undefined;
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

function readMemoryOperand(
  state: CpuState,
  operand: Mem32Operand,
  memory: GuestMemory | undefined
): OperandReadResult {
  if (memory === undefined) {
    return { kind: "unsupported" };
  }

  const read = memory.readU32(effectiveAddress(state, operand));

  return read.ok ? { kind: "value", value: read.value } : { kind: "memoryFault", fault: read.fault };
}

function writeMemoryOperand(
  state: CpuState,
  operand: Mem32Operand,
  value: number,
  memory: GuestMemory | undefined
): OperandWriteResult {
  if (memory === undefined) {
    return { kind: "unsupported" };
  }

  const write = memory.writeU32(effectiveAddress(state, operand), value);

  return write.ok ? { kind: "ok" } : { kind: "memoryFault", fault: write.fault };
}
