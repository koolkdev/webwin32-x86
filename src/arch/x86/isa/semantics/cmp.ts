import type { SemanticTemplate } from "../../sir/types.js";

export function cmpSemantic(): SemanticTemplate {
  return (s) => {
    const left = s.get32("left");
    const right = s.get32("right");
    const result = s.i32Sub(left, right);

    s.setFlags("sub32", { left, right, result });
  };
}
