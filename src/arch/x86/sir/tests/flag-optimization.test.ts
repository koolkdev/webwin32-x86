import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { buildSir } from "../builder.js";
import { SIR_ARITHMETIC_FLAG_MASK } from "../flag-analysis.js";
import { pruneDeadFlagSets } from "../flag-optimization.js";

test("flag optimization prunes flag producers with no live writes", () => {
  const program = buildSir((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const cmpResult = s.i32Sub(left, right);
    const addResult = s.i32Add(left, right);

    s.setFlags("sub32", { left, right, result: cmpResult });
    s.setFlags("add32", { left, right, result: addResult });
  });
  const optimized = pruneDeadFlagSets(program, { liveOut: SIR_ARITHMETIC_FLAG_MASK });

  strictEqual(optimized.prunedCount, 1);
  strictEqual(optimized.program.filter((op) => op.op === "flags.set").length, 1);
  deepStrictEqual(optimized.program.at(-2), {
    op: "flags.set",
    producer: "add32",
    inputs: { left: { kind: "var", id: 0 }, right: { kind: "var", id: 1 }, result: { kind: "var", id: 3 } }
  });
  deepStrictEqual(optimized.opBoundaryMap, [0, 1, 2, 3, 4, 4, 5, 6]);
});

test("flag optimization keeps producers live at barriers", () => {
  const program = buildSir((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.setFlags("add32", { left, right, result });
    s.set32(s.mem32(left), result);
    s.setFlags("logic32", { result });
  });
  const optimized = pruneDeadFlagSets(program, {
    liveOut: SIR_ARITHMETIC_FLAG_MASK,
    barriers: [{ index: 4, placement: "before", mask: SIR_ARITHMETIC_FLAG_MASK }]
  });

  strictEqual(optimized.prunedCount, 0);
  strictEqual(optimized.program.filter((op) => op.op === "flags.set").length, 2);
  deepStrictEqual(optimized.opBoundaryMap, [0, 1, 2, 3, 4, 5, 6, 7]);
});
