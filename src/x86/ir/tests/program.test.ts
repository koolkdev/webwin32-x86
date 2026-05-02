import { deepStrictEqual } from "node:assert";
import { test } from "node:test";

import { operand } from "../build/builder.js";
import { IrProgramBuilder } from "../build/program.js";

test("IrProgramBuilder appends instructions with one var namespace", () => {
  const builder = new IrProgramBuilder();
  const first = builder.appendInstruction({
    semantics: (s) => {
      const value = s.get32(s.operand(0));

      s.set32(s.reg32("eax"), value);
    },
    operands: [operand(3)]
  });
  const second = builder.appendInstruction({
    semantics: (s) => {
      s.set32(s.operand(1), s.i32Add(s.get32(s.operand(0)), 1));
    },
    operands: [operand(8), operand(9)]
  });

  deepStrictEqual(builder.build(), [
    { op: "get32", dst: { kind: "var", id: 0 }, source: { kind: "operand", index: 3 } },
    {
      op: "set32",
      target: { kind: "reg", reg: "eax" },
      value: { kind: "var", id: 0 }
    },
    { op: "next" },
    { op: "get32", dst: { kind: "var", id: 1 }, source: { kind: "operand", index: 8 } },
    {
      op: "i32.add",
      dst: { kind: "var", id: 2 },
      a: { kind: "var", id: 1 },
      b: { kind: "const32", value: 1 }
    },
    {
      op: "set32",
      target: { kind: "operand", index: 9 },
      value: { kind: "var", id: 2 }
    },
    { op: "next" }
  ]);
  deepStrictEqual(first, { terminator: "next" });
  deepStrictEqual(second, { terminator: "next" });
});
