import type { SemanticTemplate } from "../../sir/types.js";

export function testSemantic(): SemanticTemplate {
  return (s) => {
    const left = s.get32("left");
    const right = s.get32("right");
    const result = s.i32And(left, right);

    s.setFlags("logic32", { result });
  };
}
