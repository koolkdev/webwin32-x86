import { deepStrictEqual } from "node:assert";
import { test } from "node:test";

import { irVar } from "../build/builder.js";
import { CONDITIONS } from "../model/conditions.js";
import { IR_ALU_FLAG_MASK, IR_ALU_FLAG_MASKS, maskIrAluFlags } from "../passes/flag-analysis.js";
import { FLAG_PRODUCERS } from "../model/flags.js";

const left = irVar(0);
const right = irVar(1);
const result = irVar(2);

test("add32 producer defines aluFlags symbolically", () => {
  deepStrictEqual(FLAG_PRODUCERS.add32.inputs, ["left", "right", "result"]);
  deepStrictEqual(FLAG_PRODUCERS.add32.writtenMask, IR_ALU_FLAG_MASK);
  deepStrictEqual(FLAG_PRODUCERS.add32.undefMask, 0);
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
  deepStrictEqual(FLAG_PRODUCERS.logic32.writtenMask, IR_ALU_FLAG_MASK);
  deepStrictEqual(FLAG_PRODUCERS.logic32.undefMask, IR_ALU_FLAG_MASKS.AF);
  deepStrictEqual(FLAG_PRODUCERS.logic32.define({ result }), {
    ZF: { kind: "eqz", value: result },
    SF: { kind: "signBit", value: result, width: 32 },
    PF: { kind: "parity8", value: result },
    CF: { kind: "constFlag", value: 0 },
    OF: { kind: "constFlag", value: 0 },
    AF: { kind: "undefFlag" }
  });
});

test("inc32 and dec32 producers write all arithmetic flags except CF", () => {
  const writtenMask = maskIrAluFlags(["PF", "AF", "ZF", "SF", "OF"]);

  deepStrictEqual(FLAG_PRODUCERS.inc32.inputs, ["left", "result"]);
  deepStrictEqual(FLAG_PRODUCERS.inc32.writtenMask, writtenMask);
  deepStrictEqual(FLAG_PRODUCERS.inc32.undefMask, 0);
  deepStrictEqual(FLAG_PRODUCERS.inc32.define({ left, result }).CF, undefined);
  deepStrictEqual(FLAG_PRODUCERS.inc32.define({ left, result }).OF, {
    kind: "ne0",
    value: {
      kind: "and",
      a: {
        kind: "and",
        a: { kind: "xor", a: left, b: result },
        b: { kind: "xor", a: { kind: "const32", value: 1 }, b: result }
      },
      b: { kind: "const32", value: 0x8000_0000 }
    }
  });

  deepStrictEqual(FLAG_PRODUCERS.dec32.inputs, ["left", "result"]);
  deepStrictEqual(FLAG_PRODUCERS.dec32.writtenMask, writtenMask);
  deepStrictEqual(FLAG_PRODUCERS.dec32.undefMask, 0);
  deepStrictEqual(FLAG_PRODUCERS.dec32.define({ left, result }).CF, undefined);
  deepStrictEqual(FLAG_PRODUCERS.dec32.define({ left, result }).OF, {
    kind: "ne0",
    value: {
      kind: "and",
      a: {
        kind: "and",
        a: { kind: "xor", a: left, b: { kind: "const32", value: 1 } },
        b: { kind: "xor", a: left, b: result }
      },
      b: { kind: "const32", value: 0x8000_0000 }
    }
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
