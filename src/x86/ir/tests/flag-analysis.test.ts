import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { buildIr } from "../builder.js";
import {
  analyzeIrFlagLiveness,
  conditionFlagReadMask,
  flagProducerEffect,
  maskIrAluFlags,
  IR_ALU_FLAG_MASK,
  IR_FLAG_MASK_NONE,
  IR_ALU_FLAG_MASKS
} from "../flag-analysis.js";

test("flag analysis records condition read masks", () => {
  strictEqual(conditionFlagReadMask("E"), IR_ALU_FLAG_MASKS.ZF);
  strictEqual(conditionFlagReadMask("BE"), maskIrAluFlags(["CF", "ZF"]));
  strictEqual(conditionFlagReadMask("G"), maskIrAluFlags(["ZF", "SF", "OF"]));
});

test("flag analysis records producer writes and undefined flags", () => {
  deepStrictEqual(flagProducerEffect("add32"), {
    reads: IR_FLAG_MASK_NONE,
    writes: IR_ALU_FLAG_MASK,
    undefines: IR_FLAG_MASK_NONE
  });
  deepStrictEqual(flagProducerEffect("logic32"), {
    reads: IR_FLAG_MASK_NONE,
    writes: IR_ALU_FLAG_MASK,
    undefines: IR_ALU_FLAG_MASKS.AF
  });
  deepStrictEqual(flagProducerEffect("inc32"), {
    reads: IR_FLAG_MASK_NONE,
    writes: IR_ALU_FLAG_MASK & ~IR_ALU_FLAG_MASKS.CF,
    undefines: IR_FLAG_MASK_NONE
  });
});

test("flag liveness marks unused flag producer writes dead", () => {
  const program = buildIr((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.set32(s.reg32("eax"), result);
    s.setFlags("add32", { left, right, result });
  });
  const liveness = analyzeIrFlagLiveness(program);
  const flagsSetIndex = program.findIndex((op) => op.op === "flags.set");

  deepStrictEqual(liveness[flagsSetIndex], {
    reads: IR_FLAG_MASK_NONE,
    writes: IR_ALU_FLAG_MASK,
    undefines: IR_FLAG_MASK_NONE,
    liveIn: IR_FLAG_MASK_NONE,
    liveOut: IR_FLAG_MASK_NONE,
    neededWrites: IR_FLAG_MASK_NONE,
    deadWrites: IR_ALU_FLAG_MASK
  });
});

test("flag liveness keeps only flags read by a later condition", () => {
  const program = buildIr((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Sub(left, right);

    s.setFlags("sub32", { left, right, result });
    s.conditionalJump(s.condition("E"), s.get32(s.operand(0)), s.nextEip());
  });
  const liveness = analyzeIrFlagLiveness(program);
  const flagsSetIndex = program.findIndex((op) => op.op === "flags.set");
  const conditionIndex = program.findIndex((op) => op.op === "aluFlags.condition");

  deepStrictEqual(liveness[flagsSetIndex], {
    reads: IR_FLAG_MASK_NONE,
    writes: IR_ALU_FLAG_MASK,
    undefines: IR_FLAG_MASK_NONE,
    liveIn: IR_FLAG_MASK_NONE,
    liveOut: IR_ALU_FLAG_MASKS.ZF,
    neededWrites: IR_ALU_FLAG_MASKS.ZF,
    deadWrites: IR_ALU_FLAG_MASK & ~IR_ALU_FLAG_MASKS.ZF
  });
  deepStrictEqual(liveness[conditionIndex], {
    reads: IR_ALU_FLAG_MASKS.ZF,
    writes: IR_FLAG_MASK_NONE,
    undefines: IR_FLAG_MASK_NONE,
    liveIn: IR_ALU_FLAG_MASKS.ZF,
    liveOut: IR_FLAG_MASK_NONE,
    neededWrites: IR_FLAG_MASK_NONE,
    deadWrites: IR_FLAG_MASK_NONE
  });
});

test("flag liveness treats undefined writes as kills", () => {
  const program = buildIr((s) => {
    const result = s.get32(s.reg32("eax"));

    s.setFlags("logic32", { result });
  });
  const liveness = analyzeIrFlagLiveness(program, { liveOut: IR_ALU_FLAG_MASKS.AF });
  const flagsSetIndex = program.findIndex((op) => op.op === "flags.set");

  deepStrictEqual(liveness[flagsSetIndex], {
    reads: IR_FLAG_MASK_NONE,
    writes: IR_ALU_FLAG_MASK,
    undefines: IR_ALU_FLAG_MASKS.AF,
    liveIn: IR_FLAG_MASK_NONE,
    liveOut: IR_ALU_FLAG_MASKS.AF,
    neededWrites: IR_ALU_FLAG_MASKS.AF,
    deadWrites: IR_ALU_FLAG_MASK & ~IR_ALU_FLAG_MASKS.AF
  });
});

test("flag liveness keeps CF live across INC partial flag writes", () => {
  const program = buildIr((s) => {
    const addLeft = s.get32(s.reg32("eax"));
    const addRight = s.const32(1);
    const addResult = s.i32Add(addLeft, addRight);
    const incLeft = s.get32(s.reg32("eax"));
    const incResult = s.i32Add(incLeft, s.const32(1));

    s.setFlags("add32", { left: addLeft, right: addRight, result: addResult });
    s.setFlags("inc32", { left: incLeft, result: incResult });
    s.conditionalJump(s.condition("B"), s.get32(s.operand(0)), s.nextEip());
  });
  const flagSets = program
    .map((op, index) => ({ op, index }))
    .filter((entry) => entry.op.op === "flags.set");
  const liveness = analyzeIrFlagLiveness(program);
  const addIndex = flagSets[0]!.index;
  const incIndex = flagSets[1]!.index;

  deepStrictEqual(liveness[addIndex]?.neededWrites, IR_ALU_FLAG_MASKS.CF);
  deepStrictEqual(liveness[incIndex]?.neededWrites, IR_FLAG_MASK_NONE);
  deepStrictEqual(liveness[incIndex]?.liveIn, IR_ALU_FLAG_MASKS.CF);
  deepStrictEqual(liveness[incIndex]?.liveOut, IR_ALU_FLAG_MASKS.CF);
});

test("flag liveness barriers keep flags live before observable exits", () => {
  const program = buildIr((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.setFlags("add32", { left, right, result });
    s.set32(s.mem32(left), result);
    s.setFlags("logic32", { result });
  });
  const liveness = analyzeIrFlagLiveness(program, {
    liveOut: IR_ALU_FLAG_MASK,
    barriers: [{ index: 4, placement: "before", mask: IR_ALU_FLAG_MASK }]
  });

  deepStrictEqual(liveness[3], {
    reads: IR_FLAG_MASK_NONE,
    writes: IR_ALU_FLAG_MASK,
    undefines: IR_FLAG_MASK_NONE,
    liveIn: IR_FLAG_MASK_NONE,
    liveOut: IR_ALU_FLAG_MASK,
    neededWrites: IR_ALU_FLAG_MASK,
    deadWrites: IR_FLAG_MASK_NONE
  });
});

test("flag liveness treats explicit boundaries as flag reads", () => {
  const program = buildIr((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.setFlags("add32", { left, right, result });
    s.boundaryFlags(IR_ALU_FLAG_MASKS.ZF);
  });
  const liveness = analyzeIrFlagLiveness(program);
  const flagsSetIndex = program.findIndex((op) => op.op === "flags.set");
  const boundaryIndex = program.findIndex((op) => op.op === "flags.boundary");

  deepStrictEqual(liveness[flagsSetIndex], {
    reads: IR_FLAG_MASK_NONE,
    writes: IR_ALU_FLAG_MASK,
    undefines: IR_FLAG_MASK_NONE,
    liveIn: IR_FLAG_MASK_NONE,
    liveOut: IR_ALU_FLAG_MASKS.ZF,
    neededWrites: IR_ALU_FLAG_MASKS.ZF,
    deadWrites: IR_ALU_FLAG_MASK & ~IR_ALU_FLAG_MASKS.ZF
  });
  deepStrictEqual(liveness[boundaryIndex], {
    reads: IR_ALU_FLAG_MASKS.ZF,
    writes: IR_FLAG_MASK_NONE,
    undefines: IR_FLAG_MASK_NONE,
    liveIn: IR_ALU_FLAG_MASKS.ZF,
    liveOut: IR_FLAG_MASK_NONE,
    neededWrites: IR_FLAG_MASK_NONE,
    deadWrites: IR_FLAG_MASK_NONE
  });
});

test("flag liveness treats explicit materialization as a flag read", () => {
  const program = buildIr((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.setFlags("add32", { left, right, result });
    s.materializeFlags(IR_ALU_FLAG_MASKS.ZF);
  });
  const liveness = analyzeIrFlagLiveness(program);
  const flagsSetIndex = program.findIndex((op) => op.op === "flags.set");
  const materializeIndex = program.findIndex((op) => op.op === "flags.materialize");

  deepStrictEqual(liveness[flagsSetIndex], {
    reads: IR_FLAG_MASK_NONE,
    writes: IR_ALU_FLAG_MASK,
    undefines: IR_FLAG_MASK_NONE,
    liveIn: IR_FLAG_MASK_NONE,
    liveOut: IR_ALU_FLAG_MASKS.ZF,
    neededWrites: IR_ALU_FLAG_MASKS.ZF,
    deadWrites: IR_ALU_FLAG_MASK & ~IR_ALU_FLAG_MASKS.ZF
  });
  deepStrictEqual(liveness[materializeIndex], {
    reads: IR_ALU_FLAG_MASKS.ZF,
    writes: IR_FLAG_MASK_NONE,
    undefines: IR_FLAG_MASK_NONE,
    liveIn: IR_ALU_FLAG_MASKS.ZF,
    liveOut: IR_FLAG_MASK_NONE,
    neededWrites: IR_FLAG_MASK_NONE,
    deadWrites: IR_FLAG_MASK_NONE
  });
});
