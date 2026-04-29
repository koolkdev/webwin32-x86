import type { SemanticTemplate } from "../../sir/types.js";

export function leaSemantic(): SemanticTemplate {
  return (s) => {
    s.set32("dst", s.address32("src"));
  };
}
