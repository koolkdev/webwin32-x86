import type { ConditionCode, SemanticTemplate } from "#x86/ir/model/types.js";

export function movSemantic(): SemanticTemplate {
  return (s) => {
    s.set32(s.operand(0), s.get32(s.operand(1)));
  };
}

export function cmovSemantic(cc: ConditionCode): SemanticTemplate {
  return (s) => {
    const value = s.get32(s.operand(1));
    const condition = s.condition(cc);

    s.set32If(condition, s.operand(0), value);
  };
}
