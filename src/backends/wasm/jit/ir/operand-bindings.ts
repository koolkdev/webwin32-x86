import type { MemOperand, Reg32 } from "#x86/isa/types.js";
import type { IsaDecodedInstruction, IsaOperandBinding } from "#x86/isa/decoder/types.js";

export type JitOperandBinding =
  | Readonly<{ kind: "static.reg32"; reg: Reg32 }>
  | Readonly<{ kind: "static.mem32"; ea: MemOperand }>
  | Readonly<{ kind: "static.imm32"; value: number }>
  | Readonly<{ kind: "static.relTarget"; target: number }>;

export function jitBindingsFromIsaInstruction(instruction: IsaDecodedInstruction): readonly JitOperandBinding[] {
  return instruction.operands.map(jitBindingFromIsaOperand);
}

function jitBindingFromIsaOperand(operand: IsaOperandBinding): JitOperandBinding {
  switch (operand.kind) {
    case "reg":
      if (operand.alias.width !== 32) {
        throw new Error(`JIT does not support ${operand.alias.width}-bit register operands yet`);
      }

      return { kind: "static.reg32", reg: operand.alias.base };
    case "mem":
      if (operand.accessWidth !== 32) {
        throw new Error(`JIT does not support ${operand.accessWidth}-bit memory operands yet`);
      }

      return { kind: "static.mem32", ea: operand };
    case "imm":
      return { kind: "static.imm32", value: operand.value };
    case "relTarget":
      return { kind: "static.relTarget", target: operand.target };
  }
}
