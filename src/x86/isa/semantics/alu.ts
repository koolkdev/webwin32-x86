import type { SemanticTemplate } from "#x86/ir/model/types.js";
import type { OperandWidth } from "#x86/isa/types.js";

export type AluOp = "add" | "sub" | "xor" | "and" | "or";
export type IncDecOp = "inc" | "dec";

export function aluSemantic(op: AluOp, width: OperandWidth): SemanticTemplate {
  return (s) => {
    const dst = s.operand(0);
    const src = s.operand(1);
    const left = s.get(dst, width);
    const right = s.get(src, width);
    let result;

    switch (op) {
      case "add":
        result = s.i32Add(left, right);
        s.setFlags("add", { left, right, result }, width);
        break;
      case "sub":
        result = s.i32Sub(left, right);
        s.setFlags("sub", { left, right, result }, width);
        break;
      case "xor":
        result = s.i32Xor(left, right);
        s.setFlags("logic", { result }, width);
        break;
      case "and":
        result = s.i32And(left, right);
        s.setFlags("logic", { result }, width);
        break;
      case "or":
        result = s.i32Or(left, right);
        s.setFlags("logic", { result }, width);
        break;
    }

    s.set(dst, result, width);
  };
}

export function incDecSemantic(op: IncDecOp, width: OperandWidth): SemanticTemplate {
  return (s) => {
    const dst = s.operand(0);
    const left = s.get(dst, width);
    const one = s.const32(1);
    const result = op === "inc"
      ? s.i32Add(left, one)
      : s.i32Sub(left, one);

    s.setFlags(op === "inc" ? "inc" : "dec", { left, result }, width);
    s.set(dst, result, width);
  };
}
