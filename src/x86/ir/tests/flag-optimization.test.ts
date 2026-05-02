import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { buildIr } from "#x86/ir/build/builder.js";
import { IR_ALU_FLAG_MASK, IR_ALU_FLAG_MASKS } from "#x86/ir/passes/flag-analysis.js";
import { specializeAluFlagsConditions, insertFlagBoundaries, insertFlagMaterializations, pruneDeadFlagSets } from "#x86/ir/passes/flag-optimization.js";
import { createIrFlagProducerConditionOp, createIrFlagSetOp } from "#x86/ir/model/flags.js";

test("flag optimization prunes flag producers with no live writes", () => {
  const program = buildIr((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const cmpResult = s.i32Sub(left, right);
    const addResult = s.i32Add(left, right);

    s.setFlags("sub32", { left, right, result: cmpResult });
    s.setFlags("add32", { left, right, result: addResult });
  });
  const optimized = pruneDeadFlagSets(program, { liveOut: IR_ALU_FLAG_MASK });

  strictEqual(optimized.prunedCount, 1);
  strictEqual(optimized.program.filter((op) => op.op === "flags.set").length, 1);
  deepStrictEqual(
    optimized.program.at(-2),
    createIrFlagSetOp("add32", {
      left: { kind: "var", id: 0 },
      right: { kind: "var", id: 1 },
      result: { kind: "var", id: 3 }
    })
  );
});

test("flag optimization keeps producers live at barriers", () => {
  const program = buildIr((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.setFlags("add32", { left, right, result });
    s.set32(s.mem32(left), result);
    s.setFlags("logic32", { result });
  });
  const optimized = pruneDeadFlagSets(program, {
    liveOut: IR_ALU_FLAG_MASK,
    barriers: [{ index: 4, placement: "before", mask: IR_ALU_FLAG_MASK }]
  });

  strictEqual(optimized.prunedCount, 0);
  strictEqual(optimized.program.filter((op) => op.op === "flags.set").length, 2);
});

test("flag optimization tracks partial flag producers independently", () => {
  const program = buildIr((s) => {
    const addLeft = s.get32(s.reg32("eax"));
    const addRight = s.const32(1);
    const addResult = s.i32Add(addLeft, addRight);
    const incLeft = s.get32(s.reg32("eax"));
    const incResult = s.i32Add(incLeft, s.const32(1));

    s.setFlags("add32", { left: addLeft, right: addRight, result: addResult });
    s.setFlags("inc32", { left: incLeft, result: incResult });
    s.boundaryFlags(IR_ALU_FLAG_MASK);
  });
  const optimized = pruneDeadFlagSets(program);
  const flagSets = optimized.program.filter((op) => op.op === "flags.set");

  deepStrictEqual(flagSets.map((op) => op.op === "flags.set" ? op.producer : undefined), ["add32", "inc32"]);
});

test("flag optimization keeps producers live for explicit materialization", () => {
  const program = buildIr((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.setFlags("add32", { left, right, result });
    s.materializeFlags(IR_ALU_FLAG_MASKS.ZF);
  });
  const optimized = pruneDeadFlagSets(program);

  strictEqual(optimized.prunedCount, 0);
  strictEqual(optimized.program.filter((op) => op.op === "flags.set").length, 1);
});

test("flag optimization inserts materialization before flag consumers", () => {
  const program = buildIr((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Sub(left, right);

    s.setFlags("sub32", { left, right, result });
    s.conditionalJump(s.condition("E"), s.get32(s.operand(0)), s.nextEip());
  });
  const optimized = insertFlagMaterializations(program);

  strictEqual(optimized.insertedCount, 1);
  deepStrictEqual(optimized.program[4], { op: "flags.materialize", mask: IR_ALU_FLAG_MASKS.ZF });
});

test("flag optimization does not duplicate explicit materialization", () => {
  const program = buildIr((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.setFlags("add32", { left, right, result });
    s.materializeFlags(IR_ALU_FLAG_MASKS.ZF);
  });
  const optimized = insertFlagMaterializations(program);

  strictEqual(optimized.insertedCount, 0);
  deepStrictEqual(optimized.program, program);
});

test("flag optimization inserts materialization before requested exits", () => {
  const program = buildIr((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.setFlags("add32", { left, right, result });
  });
  const optimized = insertFlagMaterializations(program, {
    points: [{ index: program.length - 1, placement: "before", mask: IR_ALU_FLAG_MASK }]
  });

  strictEqual(optimized.insertedCount, 1);
  deepStrictEqual(optimized.program.at(-2), {
    op: "flags.materialize",
    mask: IR_ALU_FLAG_MASK
  });
});

test("flag optimization specializes sub32 conditions into direct flag conditions", () => {
  const program = buildIr((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Sub(left, right);

    s.setFlags("sub32", { left, right, result });
    s.conditionalJump(s.condition("E"), s.get32(s.operand(0)), s.nextEip());
  });
  const optimized = specializeAluFlagsConditions(program);
  const flagSet = program.find((op) => op.op === "flags.set");
  const conditionIndex = optimized.program.findIndex((op) => op.op === "flagProducer.condition");

  if (flagSet === undefined || flagSet.op !== "flags.set") {
    throw new Error("missing test flags.set");
  }

  strictEqual(optimized.specializedCount, 1);
  deepStrictEqual(
    optimized.program[conditionIndex],
    createIrFlagProducerConditionOp({ kind: "var", id: 3 }, "E", flagSet)
  );
});

test("flag optimization specializes all supported sub32 condition codes", () => {
  const conditionCodes = ["E", "NE", "B", "AE", "L", "GE", "LE", "G"] as const;

  for (const cc of conditionCodes) {
    const program = buildIr((s) => {
      const left = s.get32(s.reg32("eax"));
      const right = s.get32(s.reg32("ebx"));
      const result = s.i32Sub(left, right);

      s.setFlags("sub32", { left, right, result });
      s.conditionalJump(s.condition(cc), s.get32(s.operand(0)), s.nextEip());
    });
    const optimized = specializeAluFlagsConditions(program);
    const condition = optimized.program.find((op) => op.op === "flagProducer.condition");

    strictEqual(optimized.specializedCount, 1);
    strictEqual(condition?.op, "flagProducer.condition");
    strictEqual(condition?.cc, cc);
    strictEqual(condition?.producer, "sub32");
  }
});

test("flag optimization specializes conditions from the per-flag current producer", () => {
  const program = buildIr((s) => {
    const cmpLeft = s.get32(s.reg32("eax"));
    const cmpRight = s.get32(s.reg32("ebx"));
    const cmpResult = s.i32Sub(cmpLeft, cmpRight);
    const incLeft = s.get32(s.reg32("eax"));
    const incResult = s.i32Add(incLeft, s.const32(1));

    s.setFlags("sub32", { left: cmpLeft, right: cmpRight, result: cmpResult });
    s.setFlags("inc32", { left: incLeft, result: incResult });
    s.conditionalJump(s.condition("B"), s.get32(s.operand(0)), s.nextEip());
  });
  const optimized = specializeAluFlagsConditions(program);
  const subFlags = program.find((op) => op.op === "flags.set" && op.producer === "sub32");
  const flagProducerCondition = optimized.program.find((op) => op.op === "flagProducer.condition");

  if (subFlags === undefined || subFlags.op !== "flags.set") {
    throw new Error("missing test sub32 flags.set");
  }

  strictEqual(optimized.specializedCount, 1);
  deepStrictEqual(
    flagProducerCondition,
    createIrFlagProducerConditionOp({ kind: "var", id: 5 }, "B", subFlags)
  );
});

test("flag optimization does not specialize CF conditions from INC alone", () => {
  const program = buildIr((s) => {
    const incLeft = s.get32(s.reg32("eax"));
    const incResult = s.i32Add(incLeft, s.const32(1));

    s.setFlags("inc32", { left: incLeft, result: incResult });
    s.conditionalJump(s.condition("B"), s.get32(s.operand(0)), s.nextEip());
  });
  const optimized = specializeAluFlagsConditions(program);

  strictEqual(optimized.specializedCount, 0);
  strictEqual(optimized.program.some((op) => op.op === "flagProducer.condition"), false);
});

test("flag optimization does not specialize conditions from overwritten compare flags", () => {
  const program = buildIr((s) => {
    const cmpLeft = s.get32(s.reg32("eax"));
    const cmpRight = s.get32(s.reg32("ebx"));
    const cmpResult = s.i32Sub(cmpLeft, cmpRight);
    const incLeft = s.get32(s.reg32("eax"));
    const incResult = s.i32Add(incLeft, s.const32(1));

    s.setFlags("sub32", { left: cmpLeft, right: cmpRight, result: cmpResult });
    s.setFlags("inc32", { left: incLeft, result: incResult });
    s.conditionalJump(s.condition("E"), s.get32(s.operand(0)), s.nextEip());
  });
  const optimized = specializeAluFlagsConditions(program);

  strictEqual(optimized.specializedCount, 0);
  strictEqual(optimized.program.some((op) => op.op === "flagProducer.condition"), false);
});

test("flag optimization keeps specialized conditions independent of pruned flag producers", () => {
  const program = buildIr((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Sub(left, right);

    s.setFlags("sub32", { left, right, result });
    s.conditionalJump(s.condition("E"), s.get32(s.operand(0)), s.nextEip());
  });
  const specialized = specializeAluFlagsConditions(program);
  const pruned = pruneDeadFlagSets(specialized.program);

  strictEqual(pruned.program.some((op) => op.op === "flags.set"), false);
  strictEqual(pruned.program.some((op) => op.op === "flagProducer.condition"), true);
});

test("flag optimization inserts explicit boundary operations before requested points", () => {
  const program = buildIr((s) => {
    s.hostTrap(0x2e);
  });
  const optimized = insertFlagBoundaries(program, {
    points: [{ index: program.length - 1, placement: "before", mask: IR_ALU_FLAG_MASK }]
  });

  strictEqual(optimized.insertedCount, 1);
  deepStrictEqual(optimized.program, [
    { op: "flags.boundary", mask: IR_ALU_FLAG_MASK },
    { op: "hostTrap", vector: { kind: "const32", value: 0x2e } }
  ]);
});

test("flag optimization leaves boundary publication to explicit boundary operations", () => {
  const program = buildIr((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.setFlags("add32", { left, right, result });
    s.boundaryFlags(IR_ALU_FLAG_MASK);
  });
  const optimized = insertFlagMaterializations(program);

  strictEqual(optimized.insertedCount, 0);
  deepStrictEqual(optimized.program, program);
});
