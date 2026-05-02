import type { Mem32Operand, Reg32 } from "../../x86/isa/types.js";
import type { IsaDecodedInstruction, IsaOperandBinding } from "../../x86/isa/decoder/types.js";

export type JitOperandBinding =
  | Readonly<{ kind: "static.reg32"; reg: Reg32 }>
  | Readonly<{ kind: "static.mem32"; ea: Mem32Operand }>
  | Readonly<{ kind: "static.imm32"; value: number }>
  | Readonly<{ kind: "static.relTarget"; target: number }>;

export function jitBindingsFromIsaInstruction(instruction: IsaDecodedInstruction): readonly JitOperandBinding[] {
  return instruction.operands.map(jitBindingFromIsaOperand);
}

function jitBindingFromIsaOperand(operand: IsaOperandBinding): JitOperandBinding {
  switch (operand.kind) {
    case "reg32":
      return { kind: "static.reg32", reg: operand.reg };
    case "mem32":
      return { kind: "static.mem32", ea: operand };
    case "imm32":
      return { kind: "static.imm32", value: operand.value };
    case "relTarget":
      return { kind: "static.relTarget", target: operand.target };
  }
}
