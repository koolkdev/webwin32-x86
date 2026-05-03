import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { ExitReason } from "#backends/wasm/exit.js";
import { analyzeJitOptimization } from "#backends/wasm/jit/optimization/analysis.js";
import {
  jitConditionUseAt,
  jitConditionValuesAt,
  jitFirstOpIndexAfterPreInstructionExits,
  jitInstructionHasPreInstructionExit,
  jitLastPreInstructionExitOpIndex,
  jitPreInstructionExitReasonAt,
  jitPostInstructionExitReasonsAt
} from "#backends/wasm/jit/optimization/effects.js";
import {
  jitExitConditionValues,
  jitLocalConditionValues,
  jitPostInstructionExitReasons
} from "#backends/wasm/jit/optimization/effect-primitives.js";
import { c32, syntheticInstruction, v } from "./helpers.js";

test("JIT op effects identify post-instruction exits and condition values", () => {
  const fallthrough = syntheticInstruction([{ op: "next" }], 0, "exit");
  const localNext = syntheticInstruction([{ op: "next" }]);
  const localCondition = syntheticInstruction([
    { op: "set32.if", condition: v(0), target: { kind: "reg", reg: "ecx" }, value: c32(1) },
    { op: "next" }
  ]);
  const branch = syntheticInstruction([
    { op: "conditionalJump", condition: v(0), taken: c32(0x2000), notTaken: c32(0x1002) }
  ]);
  const branchOp = branch.ir[0]!;

  deepStrictEqual(jitPostInstructionExitReasons(fallthrough.ir[0]!, fallthrough), [ExitReason.FALLTHROUGH]);
  deepStrictEqual(jitPostInstructionExitReasons(localNext.ir[0]!, localNext), []);
  deepStrictEqual(jitPostInstructionExitReasons(branchOp, branch), [
    ExitReason.BRANCH_TAKEN,
    ExitReason.BRANCH_NOT_TAKEN
  ]);
  deepStrictEqual(jitLocalConditionValues(localCondition.ir[0]!), [v(0)]);
  deepStrictEqual(jitExitConditionValues(branchOp, branch), [v(0)]);
});

test("analyzeJitOptimization indexes shared op effects", () => {
  const analysis = analyzeJitOptimization({
    instructions: [
      syntheticInstruction([
        { op: "aluFlags.condition", dst: v(0), cc: "E" },
        { op: "set32.if", condition: v(0), target: { kind: "reg", reg: "ecx" }, value: c32(1) },
        { op: "conditionalJump", condition: v(0), taken: c32(0x2000), notTaken: c32(0x1002) }
      ]),
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "mem", address: c32(0x2000) } },
        { op: "next" }
      ], 1)
    ]
  });
  const effects = analysis.context.effects;

  deepStrictEqual(jitPostInstructionExitReasonsAt(effects, 0, 2), [
    ExitReason.BRANCH_TAKEN,
    ExitReason.BRANCH_NOT_TAKEN
  ]);
  deepStrictEqual(jitConditionValuesAt(effects, 0, 1, "localCondition"), [v(0)]);
  deepStrictEqual(jitConditionValuesAt(effects, 0, 2, "exitCondition"), [v(0)]);
  strictEqual(jitConditionUseAt(effects, 0, 0), "exitCondition");
  strictEqual(jitPreInstructionExitReasonAt(effects, 1, 0), ExitReason.MEMORY_READ_FAULT);
  strictEqual(jitInstructionHasPreInstructionExit(effects, 1), true);
  strictEqual(jitLastPreInstructionExitOpIndex(effects, 1), 0);
  strictEqual(jitFirstOpIndexAfterPreInstructionExits(effects, 0), 0);
  strictEqual(jitFirstOpIndexAfterPreInstructionExits(effects, 1), 1);
});

test("JIT effect helpers find the end of pre-instruction exits", () => {
  const analysis = analyzeJitOptimization({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "mem", address: c32(0x2000) } },
        { op: "i32.add", dst: v(1), a: v(0), b: c32(1) },
        { op: "set32", target: { kind: "mem", address: c32(0x2004) }, value: v(1) },
        { op: "next" }
      ])
    ]
  });
  const effects = analysis.context.effects;

  strictEqual(jitLastPreInstructionExitOpIndex(effects, 0), 2);
  strictEqual(jitFirstOpIndexAfterPreInstructionExits(effects, 0), 3);
});
