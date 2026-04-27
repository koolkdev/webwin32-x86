import type { DecodedInstruction } from "./types.js";

export function relativeTarget(instruction: DecodedInstruction): number {
  const operand = instruction.operands[0];

  if (operand?.kind !== "rel8" && operand?.kind !== "rel32") {
    throw new Error(`${instruction.mnemonic} instruction is missing a relative target`);
  }

  return operand.target;
}

export function intVector(instruction: DecodedInstruction): number {
  const operand = instruction.operands[0];

  if (operand?.kind !== "imm8") {
    throw new Error("int instruction is missing an imm8 vector");
  }

  return operand.value;
}
