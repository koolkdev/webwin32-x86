import type { SemanticTemplate } from "../../ir/model/types.js";

export function testSemantic(): SemanticTemplate {
  return (s) => {
    const left = s.get32(s.operand(0));
    const right = s.get32(s.operand(1));
    const result = s.i32And(left, right);

    s.setFlags("logic32", { result });
  };
}
