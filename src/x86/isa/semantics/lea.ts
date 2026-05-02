import type { SemanticTemplate } from "../../ir/model/types.js";

export function leaSemantic(): SemanticTemplate {
  return (s) => {
    s.set32(s.operand(0), s.address32(s.operand(1)));
  };
}
