import type { Mem32Operand, Operand, Reg32 } from "../arch/x86/instruction/types.js";

export function reg32(reg: Reg32): Operand {
  return { kind: "reg32", reg };
}

export function mem32(operand: Omit<Mem32Operand, "kind">): Mem32Operand {
  return { kind: "mem32", ...operand };
}
