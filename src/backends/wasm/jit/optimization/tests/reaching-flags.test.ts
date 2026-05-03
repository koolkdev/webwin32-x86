import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { createIrFlagSetOp } from "#x86/ir/model/flags.js";
import { IR_ALU_FLAG_MASK, IR_ALU_FLAG_MASKS } from "#x86/ir/model/flag-effects.js";
import {
  analyzeJitReachingFlags,
  singleReachingFlagProducer
} from "#backends/wasm/jit/optimization/analyses/reaching-flags.js";
import { c32, flagOwnerSummary, syntheticInstruction, v } from "./helpers.js";

test("reaching flags tracks partial flag producer ownership", () => {
  const analysis = analyzeJitReachingFlags({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "i32.add", dst: v(1), a: v(0), b: c32(1) },
        createIrFlagSetOp("add32", { left: v(0), right: c32(1), result: v(1) }),
        { op: "i32.add", dst: v(2), a: v(1), b: c32(1) },
        createIrFlagSetOp("inc32", { left: v(1), result: v(2) }),
        { op: "aluFlags.condition", dst: v(3), cc: "B" },
        { op: "conditionalJump", condition: v(3), taken: c32(0x2000), notTaken: c32(0x1001) }
      ])
    ]
  });
  const conditionRead = analysis.reads.find((read) => read.reason === "condition")!;
  const exitRead = analysis.reads.find((read) => read.reason === "exit")!;

  strictEqual(singleReachingFlagProducer(conditionRead)?.producer, "add32");
  deepStrictEqual(flagOwnerSummary(conditionRead.owners), [
    { mask: IR_ALU_FLAG_MASKS.CF, kind: "producer", sourceId: 0, producer: "add32" }
  ]);
  deepStrictEqual(flagOwnerSummary(exitRead.owners), [
    { mask: IR_ALU_FLAG_MASKS.CF, kind: "producer", sourceId: 0, producer: "add32" },
    { mask: IR_ALU_FLAG_MASK & ~IR_ALU_FLAG_MASKS.CF, kind: "producer", sourceId: 1, producer: "inc32" }
  ]);
});

test("reaching flags represents mixed-owner reads explicitly", () => {
  const analysis = analyzeJitReachingFlags({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "i32.add", dst: v(1), a: v(0), b: c32(1) },
        createIrFlagSetOp("add32", { left: v(0), right: c32(1), result: v(1) }),
        { op: "i32.add", dst: v(2), a: v(1), b: c32(1) },
        createIrFlagSetOp("inc32", { left: v(1), result: v(2) }),
        { op: "aluFlags.condition", dst: v(3), cc: "A" },
        { op: "set32.if", condition: v(3), target: { kind: "reg", reg: "ecx" }, value: c32(1) },
        { op: "next" }
      ])
    ]
  });
  const conditionRead = analysis.reads.find((read) => read.reason === "condition")!;

  strictEqual(singleReachingFlagProducer(conditionRead), undefined);
  deepStrictEqual(flagOwnerSummary(conditionRead.owners), [
    { mask: IR_ALU_FLAG_MASKS.CF, kind: "producer", sourceId: 0, producer: "add32" },
    { mask: IR_ALU_FLAG_MASKS.ZF, kind: "producer", sourceId: 1, producer: "inc32" }
  ]);
});

test("reaching flags records materialized owners and pre-instruction exit entry owners", () => {
  const analysis = analyzeJitReachingFlags({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "i32.add", dst: v(1), a: v(0), b: c32(1) },
        createIrFlagSetOp("add32", { left: v(0), right: c32(1), result: v(1) }),
        { op: "flags.materialize", mask: IR_ALU_FLAG_MASKS.ZF },
        { op: "get32", dst: v(2), source: { kind: "mem", address: c32(0x2000) } },
        { op: "next" }
      ])
    ]
  });
  const materializeRead = analysis.reads.find((read) => read.reason === "materialize")!;
  const preExitRead = analysis.reads.find((read) => read.reason === "preInstructionExit")!;

  deepStrictEqual(flagOwnerSummary(materializeRead.owners), [
    { mask: IR_ALU_FLAG_MASKS.ZF, kind: "producer", sourceId: 0, producer: "add32" }
  ]);
  deepStrictEqual(flagOwnerSummary(preExitRead.owners), [
    { mask: IR_ALU_FLAG_MASK, kind: "incoming" }
  ]);
  deepStrictEqual(flagOwnerSummary(analysis.finalOwners), [
    { mask: IR_ALU_FLAG_MASK & ~IR_ALU_FLAG_MASKS.ZF, kind: "producer", sourceId: 0, producer: "add32" },
    { mask: IR_ALU_FLAG_MASKS.ZF, kind: "materialized" }
  ]);
});
