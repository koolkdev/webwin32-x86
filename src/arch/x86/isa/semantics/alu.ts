import type { SemanticTemplate } from "../../sir/types.js";

export type AluOp = "add" | "sub" | "xor";

export function aluSemantic(op: AluOp, width: 32): SemanticTemplate {
  void width;

  return (s) => {
    const left = s.get32("dst");
    const right = s.get32("src");
    let result;

    switch (op) {
      case "add":
        result = s.i32Add(left, right);
        s.setFlags("add32", { left, right, result });
        break;
      case "sub":
        result = s.i32Sub(left, right);
        s.setFlags("sub32", { left, right, result });
        break;
      case "xor":
        result = s.i32Xor(left, right);
        s.setFlags("logic32", { result });
        break;
    }

    s.set32("dst", result);
  };
}
