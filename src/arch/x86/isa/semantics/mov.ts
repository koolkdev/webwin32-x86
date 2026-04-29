import type { SemanticTemplate } from "../../sir/types.js";

export function movSemantic(): SemanticTemplate {
  return (s) => {
    s.set32("dst", s.get32("src"));
  };
}
