import { deepStrictEqual } from "node:assert";
import { test } from "node:test";

import { operand } from "#x86/ir/build/builder.js";
import { IrBlockBuilder } from "#x86/ir/build/block.js";

test("IrBlockBuilder appends instructions with one var namespace", () => {
  const builder = new IrBlockBuilder();
  const first = builder.appendInstruction({
    semantics: (s) => {
      const value = s.get(s.operand(0));

      s.set(s.reg("eax"), value);
    },
    operands: [operand(3)]
  });
  const second = builder.appendInstruction({
    semantics: (s) => {
      s.set(s.operand(1), s.i32Add(s.get(s.operand(0)), 1));
    },
    operands: [operand(8), operand(9)]
  });

  deepStrictEqual(builder.build(), [
    { op: "get", dst: { kind: "var", id: 0 }, source: { kind: "operand", index: 3 }, accessWidth: 32 },
    {
      op: "set",
      target: { kind: "reg", reg: "eax" },
      value: { kind: "var", id: 0 },
      accessWidth: 32
    },
    { op: "next" },
    { op: "get", dst: { kind: "var", id: 1 }, source: { kind: "operand", index: 8 }, accessWidth: 32 },
    {
      op: "i32.add",
      dst: { kind: "var", id: 2 },
      a: { kind: "var", id: 1 },
      b: { kind: "const32", value: 1 }
    },
    {
      op: "set",
      target: { kind: "operand", index: 9 },
      value: { kind: "var", id: 2 },
      accessWidth: 32
    },
    { op: "next" }
  ]);
  deepStrictEqual(first, { terminator: "next" });
  deepStrictEqual(second, { terminator: "next" });
});
