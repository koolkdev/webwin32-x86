import { deepStrictEqual } from "node:assert";
import { test } from "node:test";

import { buildSirExpressionProgram } from "../expressions.js";

const v = (id: number) => ({ kind: "var" as const, id });
const op = (index: number) => ({ kind: "operand" as const, index });
const reg = (reg: "eax" | "ebx") => ({ kind: "reg" as const, reg });
const c32 = (value: number) => ({ kind: "const32" as const, value });

test("expression selector inlines allowed single-use get32 into set32", () => {
  deepStrictEqual(
    buildSirExpressionProgram(
      [
        { op: "get32", dst: v(0), source: op(1) },
        { op: "set32", target: op(0), value: v(0) },
        { op: "next" }
      ],
      { canInlineGet32: () => true }
    ),
    [
      { op: "set32", target: op(0), value: { kind: "src32", source: op(1) } },
      { op: "next" }
    ]
  );
});

test("expression selector materializes get32 when the source cannot be inlined", () => {
  deepStrictEqual(
    buildSirExpressionProgram(
      [
        { op: "get32", dst: v(0), source: op(1) },
        { op: "set32", target: op(0), value: v(0) },
        { op: "next" }
      ],
      { canInlineGet32: () => false }
    ),
    [
      { op: "let32", dst: v(0), value: { kind: "src32", source: op(1) } },
      { op: "set32", target: op(0), value: v(0) },
      { op: "next" }
    ]
  );
});

test("expression selector folds simple register arithmetic into destination values", () => {
  deepStrictEqual(
    buildSirExpressionProgram(
      [
        { op: "get32", dst: v(0), source: reg("eax") },
        { op: "i32.add", dst: v(1), a: v(0), b: c32(1) },
        { op: "set32", target: reg("ebx"), value: v(1) },
        { op: "next" }
      ],
      { canInlineGet32: () => true }
    ),
    [
      {
        op: "set32",
        target: reg("ebx"),
        value: {
          kind: "i32.add",
          a: { kind: "src32", source: reg("eax") },
          b: c32(1)
        }
      },
      { op: "next" }
    ]
  );
});

test("expression selector can reuse constant bindings without a temporary", () => {
  deepStrictEqual(
    buildSirExpressionProgram([
      { op: "const32", dst: v(0), value: 7 },
      { op: "i32.add", dst: v(1), a: v(0), b: v(0) },
      { op: "set32", target: reg("ebx"), value: v(1) },
      { op: "next" }
    ]),
    [
      {
        op: "set32",
        target: reg("ebx"),
        value: {
          kind: "i32.add",
          a: c32(7),
          b: c32(7)
        }
      },
      { op: "next" }
    ]
  );
});

test("expression selector materializes flag inputs that still need value refs", () => {
  deepStrictEqual(
    buildSirExpressionProgram(
      [
        { op: "get32", dst: v(0), source: op(0) },
        { op: "get32", dst: v(1), source: op(1) },
        { op: "i32.sub", dst: v(2), a: v(0), b: v(1) },
        { op: "flags.set", producer: "sub32", inputs: { left: v(0), right: v(1), result: v(2) } },
        { op: "next" }
      ],
      { canInlineGet32: () => true }
    ),
    [
      { op: "let32", dst: v(0), value: { kind: "src32", source: op(0) } },
      { op: "let32", dst: v(1), value: { kind: "src32", source: op(1) } },
      { op: "let32", dst: v(2), value: { kind: "i32.sub", a: v(0), b: v(1) } },
      { op: "flags.set", producer: "sub32", inputs: { left: v(0), right: v(1), result: v(2) } },
      { op: "next" }
    ]
  );
});
