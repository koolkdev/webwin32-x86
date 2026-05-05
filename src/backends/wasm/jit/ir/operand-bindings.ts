import type { MemOperand, RegisterAlias } from "#x86/isa/types.js";
import type { IsaDecodedInstruction, IsaOperandBinding } from "#x86/isa/decoder/types.js";

export type JitOperandBinding =
  | Readonly<{ kind: "static.reg"; alias: RegisterAlias }>
  | Readonly<{ kind: "static.mem"; ea: MemOperand }>
  | Readonly<{ kind: "static.imm32"; value: number }>
  | Readonly<{ kind: "static.relTarget"; target: number }>;

export function jitBindingsFromIsaInstruction(instruction: IsaDecodedInstruction): readonly JitOperandBinding[] {
  return instruction.operands.map(jitBindingFromIsaOperand);
}

function jitBindingFromIsaOperand(operand: IsaOperandBinding): JitOperandBinding {
  switch (operand.kind) {
    case "reg":
      return { kind: "static.reg", alias: operand.alias };
    case "mem":
      return { kind: "static.mem", ea: operand };
    case "imm":
      return { kind: "static.imm32", value: operand.value };
    case "relTarget":
      return { kind: "static.relTarget", target: operand.target };
  }
}
