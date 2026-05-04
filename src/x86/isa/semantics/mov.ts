import type { ConditionCode, SemanticTemplate } from "#x86/ir/model/types.js";
import type { OperandWidth } from "#x86/isa/types.js";

export function movSemantic(width: OperandWidth = 32): SemanticTemplate {
  return (s) => {
    s.set(s.operand(0), s.get(s.operand(1), width), width);
  };
}

export function cmovSemantic(cc: ConditionCode, width: OperandWidth = 32): SemanticTemplate {
  return (s) => {
    const value = s.get(s.operand(1), width);
    const condition = s.condition(cc);

    s.setIf(condition, s.operand(0), value, width);
  };
}
