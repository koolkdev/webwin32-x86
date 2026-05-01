import { deepStrictEqual, throws } from "node:assert";
import { test } from "node:test";

import { buildSir, SirProgramSequenceBuilder } from "../builder.js";

test("builder appends implicit next for fallthrough templates", () => {
  deepStrictEqual(buildSir(() => {}), [{ op: "next" }]);
});

test("builder rejects ops after a terminator", () => {
  throws(
    () =>
      buildSir((s) => {
        s.jump(s.get32(s.operand(0)));
        s.get32(s.operand(1));
      }),
    /cannot emit get32 after SIR terminator/
  );
});

test("SirProgramSequenceBuilder builds segments with shared var ids and offset operands", () => {
  const builder = new SirProgramSequenceBuilder();
  const first = builder.append((s) => {
    const value = s.get32(s.operand(0));

    s.set32(s.reg32("eax"), value);
  }, { operandCount: 1 });
  const second = builder.append((s) => {
    s.set32(s.operand(1), s.i32Add(s.get32(s.operand(0)), 1));
  }, { operandCount: 2 });

  deepStrictEqual(
    builder.build(),
    {
      program: [
        { op: "get32", dst: { kind: "var", id: 0 }, source: { kind: "operand", index: 0 } },
        {
          op: "set32",
          target: { kind: "reg", reg: "eax" },
          value: { kind: "var", id: 0 }
        },
        { op: "next" },
        { op: "get32", dst: { kind: "var", id: 1 }, source: { kind: "operand", index: 1 } },
        {
          op: "i32.add",
          dst: { kind: "var", id: 2 },
          a: { kind: "var", id: 1 },
          b: { kind: "const32", value: 1 }
        },
        {
          op: "set32",
          target: { kind: "operand", index: 2 },
          value: { kind: "var", id: 2 }
        },
        { op: "next" }
      ],
      segments: [
        { opStart: 0, opEnd: 3, operandStart: 0, operandEnd: 1, terminator: "next" },
        { opStart: 3, opEnd: 7, operandStart: 1, operandEnd: 3, terminator: "next" }
      ],
      operandCount: 3
    }
  );
  deepStrictEqual(first, { opStart: 0, opEnd: 3, operandStart: 0, operandEnd: 1, terminator: "next" });
  deepStrictEqual(second, { opStart: 3, opEnd: 7, operandStart: 1, operandEnd: 3, terminator: "next" });
});
