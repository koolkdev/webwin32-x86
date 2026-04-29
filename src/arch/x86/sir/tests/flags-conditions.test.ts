import { deepStrictEqual } from "node:assert";
import { test } from "node:test";

import { sirVar } from "../builder.js";
import { CONDITIONS } from "../conditions.js";
import { FLAG_PRODUCERS } from "../flags.js";

const left = sirVar(0);
const right = sirVar(1);
const result = sirVar(2);

test("add32 producer defines arithmetic flags symbolically", () => {
  deepStrictEqual(FLAG_PRODUCERS.add32.inputs, ["left", "right", "result"]);
  deepStrictEqual(FLAG_PRODUCERS.add32.define({ left, right, result }), {
    ZF: { kind: "eqz", value: result },
    SF: { kind: "signBit", value: result, width: 32 },
    PF: { kind: "parity8", value: result },
    CF: { kind: "uLt", a: result, b: left },
    AF: {
      kind: "bit",
      value: {
        kind: "xor",
        a: { kind: "xor", a: left, b: right },
        b: result
      },
      bit: 4
    },
    OF: {
      kind: "ne0",
      value: {
        kind: "and",
        a: {
          kind: "and",
          a: { kind: "xor", a: left, b: result },
          b: { kind: "xor", a: right, b: result }
        },
        b: { kind: "const32", value: 0x8000_0000 }
      }
    }
  });
});

test("sub32 producer defines borrow and overflow symbolically", () => {
  deepStrictEqual(FLAG_PRODUCERS.sub32.inputs, ["left", "right", "result"]);
  deepStrictEqual(FLAG_PRODUCERS.sub32.define({ left, right, result }).CF, {
    kind: "uLt",
    a: left,
    b: right
  });
  deepStrictEqual(FLAG_PRODUCERS.sub32.define({ left, right, result }).OF, {
    kind: "ne0",
    value: {
      kind: "and",
      a: {
        kind: "and",
        a: { kind: "xor", a: left, b: right },
        b: { kind: "xor", a: left, b: result }
      },
      b: { kind: "const32", value: 0x8000_0000 }
    }
  });
});

test("logic32 producer defines logical flags and keeps AF undefined", () => {
  deepStrictEqual(FLAG_PRODUCERS.logic32.inputs, ["result"]);
  deepStrictEqual(FLAG_PRODUCERS.logic32.define({ result }), {
    ZF: { kind: "eqz", value: result },
    SF: { kind: "signBit", value: result, width: 32 },
    PF: { kind: "parity8", value: result },
    CF: { kind: "constFlag", value: 0 },
    OF: { kind: "constFlag", value: 0 },
    AF: { kind: "undefFlag" }
  });
});

test("condition registry records flag reads and boolean formulas", () => {
  deepStrictEqual(CONDITIONS.NE, {
    reads: ["ZF"],
    expr: { kind: "not", value: { kind: "flag", flag: "ZF" } }
  });
  deepStrictEqual(CONDITIONS.LE, {
    reads: ["ZF", "SF", "OF"],
    expr: {
      kind: "or",
      a: { kind: "flag", flag: "ZF" },
      b: {
        kind: "xor",
        a: { kind: "flag", flag: "SF" },
        b: { kind: "flag", flag: "OF" }
      }
    }
  });
});
