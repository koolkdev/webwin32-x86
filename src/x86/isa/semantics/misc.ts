import type { SemanticTemplate } from "../../ir/types.js";

export function nopSemantic(): SemanticTemplate {
  return (s) => {
    s.next();
  };
}

export function intSemantic(): SemanticTemplate {
  return (s) => {
    s.hostTrap(s.get32(s.operand(0)));
  };
}
