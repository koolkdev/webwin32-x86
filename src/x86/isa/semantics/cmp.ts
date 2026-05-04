import type { SemanticTemplate } from "#x86/ir/model/types.js";
import type { OperandWidth } from "#x86/isa/types.js";

export function cmpSemantic(width: OperandWidth = 32): SemanticTemplate {
  return (s) => {
    const left = s.get(s.operand(0), width);
    const right = s.get(s.operand(1), width);
    const result = s.i32Sub(left, right);

    s.setFlags("sub", { left, right, result }, width);
  };
}
