import type { SemanticTemplate } from "#x86/ir/model/types.js";

export function cmpSemantic(): SemanticTemplate {
  return (s) => {
    const left = s.get32(s.operand(0));
    const right = s.get32(s.operand(1));
    const result = s.i32Sub(left, right);

    s.setFlags("sub32", { left, right, result });
  };
}
