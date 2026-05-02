import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { buildSir } from "../builder.js";
import { SIR_ALU_FLAG_MASK, SIR_ALU_FLAG_MASKS } from "../flag-analysis.js";
import { insertFlagBoundaries, insertFlagMaterializations, pruneDeadFlagSets } from "../flag-optimization.js";

test("flag optimization prunes flag producers with no live writes", () => {
  const program = buildSir((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const cmpResult = s.i32Sub(left, right);
    const addResult = s.i32Add(left, right);

    s.setFlags("sub32", { left, right, result: cmpResult });
    s.setFlags("add32", { left, right, result: addResult });
  });
  const optimized = pruneDeadFlagSets(program, { liveOut: SIR_ALU_FLAG_MASK });

  strictEqual(optimized.prunedCount, 1);
  strictEqual(optimized.program.filter((op) => op.op === "flags.set").length, 1);
  deepStrictEqual(optimized.program.at(-2), {
    op: "flags.set",
    producer: "add32",
    inputs: { left: { kind: "var", id: 0 }, right: { kind: "var", id: 1 }, result: { kind: "var", id: 3 } }
  });
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
    liveOut: SIR_ALU_FLAG_MASK,
    barriers: [{ index: 4, placement: "before", mask: SIR_ALU_FLAG_MASK }]
  });

  strictEqual(optimized.prunedCount, 0);
  strictEqual(optimized.program.filter((op) => op.op === "flags.set").length, 2);
});

test("flag optimization keeps producers live for explicit materialization", () => {
  const program = buildSir((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.setFlags("add32", { left, right, result });
    s.materializeFlags(SIR_ALU_FLAG_MASKS.ZF);
  });
  const optimized = pruneDeadFlagSets(program);

  strictEqual(optimized.prunedCount, 0);
  strictEqual(optimized.program.filter((op) => op.op === "flags.set").length, 1);
});

test("flag optimization inserts materialization before flag consumers", () => {
  const program = buildSir((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Sub(left, right);

    s.setFlags("sub32", { left, right, result });
    s.conditionalJump(s.condition("E"), s.get32(s.operand(0)), s.nextEip());
  });
  const optimized = insertFlagMaterializations(program);

  strictEqual(optimized.insertedCount, 1);
  deepStrictEqual(optimized.program[4], { op: "flags.materialize", mask: SIR_ALU_FLAG_MASKS.ZF });
});

test("flag optimization does not duplicate explicit materialization", () => {
  const program = buildSir((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.setFlags("add32", { left, right, result });
    s.materializeFlags(SIR_ALU_FLAG_MASKS.ZF);
  });
  const optimized = insertFlagMaterializations(program);

  strictEqual(optimized.insertedCount, 0);
  deepStrictEqual(optimized.program, program);
});

test("flag optimization inserts materialization before requested exits", () => {
  const program = buildSir((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.setFlags("add32", { left, right, result });
  });
  const optimized = insertFlagMaterializations(program, {
    points: [{ index: program.length - 1, placement: "before", mask: SIR_ALU_FLAG_MASK }]
  });

  strictEqual(optimized.insertedCount, 1);
  deepStrictEqual(optimized.program.at(-2), {
    op: "flags.materialize",
    mask: SIR_ALU_FLAG_MASK
  });
});

test("flag optimization inserts explicit boundary operations before requested points", () => {
  const program = buildSir((s) => {
    s.hostTrap(0x2e);
  });
  const optimized = insertFlagBoundaries(program, {
    points: [{ index: program.length - 1, placement: "before", mask: SIR_ALU_FLAG_MASK }]
  });

  strictEqual(optimized.insertedCount, 1);
  deepStrictEqual(optimized.program, [
    { op: "flags.boundary", mask: SIR_ALU_FLAG_MASK },
    { op: "hostTrap", vector: { kind: "const32", value: 0x2e } }
  ]);
});

test("flag optimization leaves boundary publication to explicit boundary operations", () => {
  const program = buildSir((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.setFlags("add32", { left, right, result });
    s.boundaryFlags(SIR_ALU_FLAG_MASK);
  });
  const optimized = insertFlagMaterializations(program);

  strictEqual(optimized.insertedCount, 0);
  deepStrictEqual(optimized.program, program);
});
