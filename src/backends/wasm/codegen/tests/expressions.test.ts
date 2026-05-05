import { deepStrictEqual } from "node:assert";
import { test } from "node:test";

import { buildIrExpressionBlock } from "#backends/wasm/codegen/expressions.js";
import { IR_ALU_FLAG_MASK, IR_ALU_FLAG_MASKS } from "#x86/ir/model/flag-effects.js";
import { createIrFlagSetOp } from "#x86/ir/model/flags.js";

const v = (id: number) => ({ kind: "var" as const, id });
const op = (index: number) => ({ kind: "operand" as const, index });
const reg = (reg: "eax" | "ebx") => ({ kind: "reg" as const, reg });
const c32 = (value: number) => ({ kind: "const32" as const, value });
const sourceValue = (source: ReturnType<typeof op> | ReturnType<typeof reg>) => ({
  kind: "source" as const,
  source,
  accessWidth: 32 as const
});
const set = (
  target: ReturnType<typeof op> | ReturnType<typeof reg>,
  value: ReturnType<typeof v> | ReturnType<typeof c32> | ReturnType<typeof sourceValue> | Readonly<{
    kind: "i32.add" | "i32.sub";
    a: ReturnType<typeof v> | ReturnType<typeof c32> | ReturnType<typeof sourceValue>;
    b: ReturnType<typeof v> | ReturnType<typeof c32> | ReturnType<typeof sourceValue>;
  }>
) => ({ op: "set" as const, target, value, accessWidth: 32 as const });

test("expression selector inlines allowed single-use get into set", () => {
  deepStrictEqual(
    buildIrExpressionBlock(
      [
        { op: "get", dst: v(0), source: op(1) },
        { op: "set", target: op(0), value: v(0) },
        { op: "next" }
      ],
      { canInlineGet: () => true }
    ),
    [
      set(op(0), sourceValue(op(1))),
      { op: "next" }
    ]
  );
});

test("expression selector materializes get when the source cannot be inlined", () => {
  deepStrictEqual(
    buildIrExpressionBlock(
      [
        { op: "get", dst: v(0), source: op(1) },
        { op: "set", target: op(0), value: v(0) },
        { op: "next" }
      ],
      { canInlineGet: () => false }
    ),
    [
      { op: "let32", dst: v(0), value: sourceValue(op(1)) },
      set(op(0), v(0)),
      { op: "next" }
    ]
  );
});

test("expression selector folds simple register arithmetic into destination values", () => {
  deepStrictEqual(
    buildIrExpressionBlock(
      [
        { op: "get", dst: v(0), source: reg("eax") },
        { op: "i32.add", dst: v(1), a: v(0), b: c32(1) },
        { op: "set", target: reg("ebx"), value: v(1) },
        { op: "next" }
      ],
      { canInlineGet: () => true }
    ),
    [
      {
        ...set(reg("ebx"), {
          kind: "i32.add",
          a: sourceValue(reg("eax")),
          b: c32(1)
        })
      },
      { op: "next" }
    ]
  );
});

test("expression selector can reuse const32 bindings without a temporary", () => {
  deepStrictEqual(
    buildIrExpressionBlock([
      { op: "const32", dst: v(0), value: 7 },
      { op: "i32.add", dst: v(1), a: v(0), b: v(0) },
      { op: "set", target: reg("ebx"), value: v(1) },
      { op: "next" }
    ]),
    [
      {
        ...set(reg("ebx"), {
          kind: "i32.add",
          a: c32(7),
          b: c32(7)
        })
      },
      { op: "next" }
    ]
  );
});

test("expression selector materializes flag inputs that still need value refs", () => {
  deepStrictEqual(
    buildIrExpressionBlock(
      [
        { op: "get", dst: v(0), source: op(0) },
        { op: "get", dst: v(1), source: op(1) },
        { op: "i32.sub", dst: v(2), a: v(0), b: v(1) },
        createIrFlagSetOp("sub", { left: v(0), right: v(1), result: v(2) }),
        { op: "next" }
      ],
      { canInlineGet: () => true }
    ),
    [
      { op: "let32", dst: v(0), value: sourceValue(op(0)) },
      { op: "let32", dst: v(1), value: sourceValue(op(1)) },
      { op: "let32", dst: v(2), value: { kind: "i32.sub", a: v(0), b: v(1) } },
      createIrFlagSetOp("sub", { left: v(0), right: v(1), result: v(2) }),
      { op: "next" }
    ]
  );
});

test("expression selector materializes conditional set values at their definition", () => {
  deepStrictEqual(
    buildIrExpressionBlock(
      [
        { op: "get", dst: v(0), source: op(1) },
        { op: "aluFlags.condition", dst: v(1), cc: "E" },
        { op: "set.if", condition: v(1), target: op(0), value: v(0) },
        { op: "next" }
      ],
      { canInlineGet: () => true }
    ),
    [
      { op: "let32", dst: v(0), value: sourceValue(op(1)) },
      { op: "let32", dst: v(1), value: { kind: "aluFlags.condition", cc: "E" } },
      { op: "set.if", condition: v(1), target: op(0), value: v(0), accessWidth: 32 },
      { op: "next" }
    ]
  );
});

test("expression selector keeps condition reads before later flag boundaries", () => {
  deepStrictEqual(
    buildIrExpressionBlock([
      { op: "flags.materialize", mask: IR_ALU_FLAG_MASKS.ZF },
      { op: "aluFlags.condition", dst: v(0), cc: "E" },
      { op: "flags.boundary", mask: IR_ALU_FLAG_MASK },
      { op: "conditionalJump", condition: v(0), taken: c32(0x2000), notTaken: c32(0x1002) }
    ]),
    [
      { op: "flags.materialize", mask: IR_ALU_FLAG_MASKS.ZF },
      { op: "let32", dst: v(0), value: { kind: "aluFlags.condition", cc: "E" } },
      { op: "flags.boundary", mask: IR_ALU_FLAG_MASK },
      { op: "conditionalJump", condition: v(0), taken: c32(0x2000), notTaken: c32(0x1002) }
    ]
  );
});
