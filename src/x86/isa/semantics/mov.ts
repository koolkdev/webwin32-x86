import type { SemanticTemplate } from "#x86/ir/model/types.js";

export function movSemantic(): SemanticTemplate {
  return (s) => {
    s.set32(s.operand(0), s.get32(s.operand(1)));
  };
}
