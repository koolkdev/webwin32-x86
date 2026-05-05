import type { OperandWidth } from "#x86/isa/types.js";
import type { SemanticTemplate } from "#x86/ir/model/types.js";

export function xchgSemantic(width: OperandWidth = 32): SemanticTemplate {
  return (s) => {
    const left = s.get(s.operand(0), width);
    const right = s.get(s.operand(1), width);

    s.set(s.operand(0), right, width);
    s.set(s.operand(1), left, width);
  };
}
