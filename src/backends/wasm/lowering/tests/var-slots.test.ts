import { strictEqual } from "node:assert";
import { test } from "node:test";

import { assignIrExprVarSlots } from "../var-slots.js";

const v = (id: number) => ({ kind: "var" as const, id });
const reg = (reg: "eax" | "ebx") => ({ kind: "reg" as const, reg });
const c32 = (value: number) => ({ kind: "const32" as const, value });

test("assignIrExprVarSlots reuses slots after last use", () => {
  const slots = assignIrExprVarSlots([
    { op: "let32", dst: v(0), value: c32(1) },
    { op: "set32", target: reg("eax"), value: v(0) },
    { op: "let32", dst: v(1), value: c32(2) },
    { op: "set32", target: reg("ebx"), value: v(1) },
    { op: "next" }
  ]);

  strictEqual(slots.slotCount, 1);
  strictEqual(slots.slotByVar.get(0), 0);
  strictEqual(slots.slotByVar.get(1), 0);
});

test("assignIrExprVarSlots can reuse a last-use input slot for a let destination", () => {
  const slots = assignIrExprVarSlots([
    { op: "let32", dst: v(0), value: c32(1) },
    { op: "let32", dst: v(1), value: { kind: "i32.add", a: v(0), b: c32(2) } },
    { op: "set32", target: reg("eax"), value: v(1) },
    { op: "next" }
  ]);

  strictEqual(slots.slotCount, 1);
  strictEqual(slots.slotByVar.get(0), 0);
  strictEqual(slots.slotByVar.get(1), 0);
});

test("assignIrExprVarSlots keeps overlapping values in separate slots", () => {
  const slots = assignIrExprVarSlots([
    { op: "let32", dst: v(0), value: c32(1) },
    { op: "let32", dst: v(1), value: c32(2) },
    { op: "set32", target: reg("eax"), value: { kind: "i32.add", a: v(0), b: v(1) } },
    { op: "next" }
  ]);

  strictEqual(slots.slotCount, 2);
  strictEqual(slots.slotByVar.get(0), 0);
  strictEqual(slots.slotByVar.get(1), 1);
});
