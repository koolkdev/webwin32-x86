import type { SemanticTemplate } from "#x86/ir/model/types.js";

export function leaSemantic(): SemanticTemplate {
  return (s) => {
    s.set(s.operand(0), s.address(s.operand(1)));
  };
}
