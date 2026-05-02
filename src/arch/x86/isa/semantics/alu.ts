import type { SemanticTemplate } from "../../ir/types.js";

export type AluOp = "add" | "sub" | "xor" | "and" | "or";
export type IncDecOp = "inc" | "dec";

export function aluSemantic(op: AluOp, width: 32): SemanticTemplate {
  void width;

  return (s) => {
    const dst = s.operand(0);
    const src = s.operand(1);
    const left = s.get32(dst);
    const right = s.get32(src);
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
      case "and":
        result = s.i32And(left, right);
        s.setFlags("logic32", { result });
        break;
      case "or":
        result = s.i32Or(left, right);
        s.setFlags("logic32", { result });
        break;
    }

    s.set32(dst, result);
  };
}

export function incDecSemantic(op: IncDecOp, width: 32): SemanticTemplate {
  void width;

  return (s) => {
    const dst = s.operand(0);
    const left = s.get32(dst);
    const one = s.const32(1);
    const result = op === "inc"
      ? s.i32Add(left, one)
      : s.i32Sub(left, one);

    s.setFlags(op === "inc" ? "inc32" : "dec32", { left, result });
    s.set32(dst, result);
  };
}
