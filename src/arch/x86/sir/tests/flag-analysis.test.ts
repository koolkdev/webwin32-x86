import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { buildSir } from "../builder.js";
import {
  analyzeSirFlagLiveness,
  conditionFlagReadMask,
  flagProducerEffect,
  maskSirAluFlags,
  SIR_ALU_FLAG_MASK,
  SIR_FLAG_MASK_NONE,
  SIR_ALU_FLAG_MASKS
} from "../flag-analysis.js";

test("flag analysis records condition read masks", () => {
  strictEqual(conditionFlagReadMask("E"), SIR_ALU_FLAG_MASKS.ZF);
  strictEqual(conditionFlagReadMask("BE"), maskSirAluFlags(["CF", "ZF"]));
  strictEqual(conditionFlagReadMask("G"), maskSirAluFlags(["ZF", "SF", "OF"]));
});

test("flag analysis records producer writes and undefined flags", () => {
  deepStrictEqual(flagProducerEffect("add32"), {
    reads: SIR_FLAG_MASK_NONE,
    writes: SIR_ALU_FLAG_MASK,
    undefines: SIR_FLAG_MASK_NONE
  });
  deepStrictEqual(flagProducerEffect("logic32"), {
    reads: SIR_FLAG_MASK_NONE,
    writes: SIR_ALU_FLAG_MASK,
    undefines: SIR_ALU_FLAG_MASKS.AF
  });
  deepStrictEqual(flagProducerEffect("inc32"), {
    reads: SIR_FLAG_MASK_NONE,
    writes: SIR_ALU_FLAG_MASK & ~SIR_ALU_FLAG_MASKS.CF,
    undefines: SIR_FLAG_MASK_NONE
  });
});

test("flag liveness marks unused flag producer writes dead", () => {
  const program = buildSir((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.set32(s.reg32("eax"), result);
    s.setFlags("add32", { left, right, result });
  });
  const liveness = analyzeSirFlagLiveness(program);
  const flagsSetIndex = program.findIndex((op) => op.op === "flags.set");

  deepStrictEqual(liveness[flagsSetIndex], {
    reads: SIR_FLAG_MASK_NONE,
    writes: SIR_ALU_FLAG_MASK,
    undefines: SIR_FLAG_MASK_NONE,
    liveIn: SIR_FLAG_MASK_NONE,
    liveOut: SIR_FLAG_MASK_NONE,
    neededWrites: SIR_FLAG_MASK_NONE,
    deadWrites: SIR_ALU_FLAG_MASK
  });
});

test("flag liveness keeps only flags read by a later condition", () => {
  const program = buildSir((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Sub(left, right);

    s.setFlags("sub32", { left, right, result });
    s.conditionalJump(s.condition("E"), s.get32(s.operand(0)), s.nextEip());
  });
  const liveness = analyzeSirFlagLiveness(program);
  const flagsSetIndex = program.findIndex((op) => op.op === "flags.set");
  const conditionIndex = program.findIndex((op) => op.op === "condition");

  deepStrictEqual(liveness[flagsSetIndex], {
    reads: SIR_FLAG_MASK_NONE,
    writes: SIR_ALU_FLAG_MASK,
    undefines: SIR_FLAG_MASK_NONE,
    liveIn: SIR_FLAG_MASK_NONE,
    liveOut: SIR_ALU_FLAG_MASKS.ZF,
    neededWrites: SIR_ALU_FLAG_MASKS.ZF,
    deadWrites: SIR_ALU_FLAG_MASK & ~SIR_ALU_FLAG_MASKS.ZF
  });
  deepStrictEqual(liveness[conditionIndex], {
    reads: SIR_ALU_FLAG_MASKS.ZF,
    writes: SIR_FLAG_MASK_NONE,
    undefines: SIR_FLAG_MASK_NONE,
    liveIn: SIR_ALU_FLAG_MASKS.ZF,
    liveOut: SIR_FLAG_MASK_NONE,
    neededWrites: SIR_FLAG_MASK_NONE,
    deadWrites: SIR_FLAG_MASK_NONE
  });
});

test("flag liveness treats undefined writes as kills", () => {
  const program = buildSir((s) => {
    const result = s.get32(s.reg32("eax"));

    s.setFlags("logic32", { result });
  });
  const liveness = analyzeSirFlagLiveness(program, { liveOut: SIR_ALU_FLAG_MASKS.AF });
  const flagsSetIndex = program.findIndex((op) => op.op === "flags.set");

  deepStrictEqual(liveness[flagsSetIndex], {
    reads: SIR_FLAG_MASK_NONE,
    writes: SIR_ALU_FLAG_MASK,
    undefines: SIR_ALU_FLAG_MASKS.AF,
    liveIn: SIR_FLAG_MASK_NONE,
    liveOut: SIR_ALU_FLAG_MASKS.AF,
    neededWrites: SIR_ALU_FLAG_MASKS.AF,
    deadWrites: SIR_ALU_FLAG_MASK & ~SIR_ALU_FLAG_MASKS.AF
  });
});

test("flag liveness keeps CF live across INC partial flag writes", () => {
  const program = buildSir((s) => {
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
  const liveness = analyzeSirFlagLiveness(program);
  const addIndex = flagSets[0]!.index;
  const incIndex = flagSets[1]!.index;

  deepStrictEqual(liveness[addIndex]?.neededWrites, SIR_ALU_FLAG_MASKS.CF);
  deepStrictEqual(liveness[incIndex]?.neededWrites, SIR_FLAG_MASK_NONE);
  deepStrictEqual(liveness[incIndex]?.liveIn, SIR_ALU_FLAG_MASKS.CF);
  deepStrictEqual(liveness[incIndex]?.liveOut, SIR_ALU_FLAG_MASKS.CF);
});

test("flag liveness barriers keep flags live before observable exits", () => {
  const program = buildSir((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.setFlags("add32", { left, right, result });
    s.set32(s.mem32(left), result);
    s.setFlags("logic32", { result });
  });
  const liveness = analyzeSirFlagLiveness(program, {
    liveOut: SIR_ALU_FLAG_MASK,
    barriers: [{ index: 4, placement: "before", mask: SIR_ALU_FLAG_MASK }]
  });

  deepStrictEqual(liveness[3], {
    reads: SIR_FLAG_MASK_NONE,
    writes: SIR_ALU_FLAG_MASK,
    undefines: SIR_FLAG_MASK_NONE,
    liveIn: SIR_FLAG_MASK_NONE,
    liveOut: SIR_ALU_FLAG_MASK,
    neededWrites: SIR_ALU_FLAG_MASK,
    deadWrites: SIR_FLAG_MASK_NONE
  });
});

test("flag liveness treats explicit boundaries as flag reads", () => {
  const program = buildSir((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.setFlags("add32", { left, right, result });
    s.boundaryFlags(SIR_ALU_FLAG_MASKS.ZF);
  });
  const liveness = analyzeSirFlagLiveness(program);
  const flagsSetIndex = program.findIndex((op) => op.op === "flags.set");
  const boundaryIndex = program.findIndex((op) => op.op === "flags.boundary");

  deepStrictEqual(liveness[flagsSetIndex], {
    reads: SIR_FLAG_MASK_NONE,
    writes: SIR_ALU_FLAG_MASK,
    undefines: SIR_FLAG_MASK_NONE,
    liveIn: SIR_FLAG_MASK_NONE,
    liveOut: SIR_ALU_FLAG_MASKS.ZF,
    neededWrites: SIR_ALU_FLAG_MASKS.ZF,
    deadWrites: SIR_ALU_FLAG_MASK & ~SIR_ALU_FLAG_MASKS.ZF
  });
  deepStrictEqual(liveness[boundaryIndex], {
    reads: SIR_ALU_FLAG_MASKS.ZF,
    writes: SIR_FLAG_MASK_NONE,
    undefines: SIR_FLAG_MASK_NONE,
    liveIn: SIR_ALU_FLAG_MASKS.ZF,
    liveOut: SIR_FLAG_MASK_NONE,
    neededWrites: SIR_FLAG_MASK_NONE,
    deadWrites: SIR_FLAG_MASK_NONE
  });
});

test("flag liveness treats explicit materialization as a flag read", () => {
  const program = buildSir((s) => {
    const left = s.get32(s.reg32("eax"));
    const right = s.get32(s.reg32("ebx"));
    const result = s.i32Add(left, right);

    s.setFlags("add32", { left, right, result });
    s.materializeFlags(SIR_ALU_FLAG_MASKS.ZF);
  });
  const liveness = analyzeSirFlagLiveness(program);
  const flagsSetIndex = program.findIndex((op) => op.op === "flags.set");
  const materializeIndex = program.findIndex((op) => op.op === "flags.materialize");

  deepStrictEqual(liveness[flagsSetIndex], {
    reads: SIR_FLAG_MASK_NONE,
    writes: SIR_ALU_FLAG_MASK,
    undefines: SIR_FLAG_MASK_NONE,
    liveIn: SIR_FLAG_MASK_NONE,
    liveOut: SIR_ALU_FLAG_MASKS.ZF,
    neededWrites: SIR_ALU_FLAG_MASKS.ZF,
    deadWrites: SIR_ALU_FLAG_MASK & ~SIR_ALU_FLAG_MASKS.ZF
  });
  deepStrictEqual(liveness[materializeIndex], {
    reads: SIR_ALU_FLAG_MASKS.ZF,
    writes: SIR_FLAG_MASK_NONE,
    undefines: SIR_FLAG_MASK_NONE,
    liveIn: SIR_ALU_FLAG_MASKS.ZF,
    liveOut: SIR_FLAG_MASK_NONE,
    neededWrites: SIR_FLAG_MASK_NONE,
    deadWrites: SIR_FLAG_MASK_NONE
  });
});
