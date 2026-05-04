import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { createIrFlagSetOp } from "#x86/ir/model/flags.js";
import { flagConditionSpecializationPass, specializeJitFlagConditions } from "#backends/wasm/jit/optimization/passes/flag-condition-specialization.js";
import { runJitOptimizationPasses } from "#backends/wasm/jit/optimization/pass.js";
import { c32, syntheticInstruction, v } from "./helpers.js";

test("flag-condition-specialization emits direct cmp branch conditions", () => {
  const result = specializeJitFlagConditions({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "get32", dst: v(1), source: { kind: "reg", reg: "ebx" } },
        { op: "i32.sub", dst: v(2), a: v(0), b: v(1) },
        createIrFlagSetOp("sub32", { left: v(0), right: v(1), result: v(2) }),
        { op: "aluFlags.condition", dst: v(3), cc: "E" },
        { op: "conditionalJump", condition: v(3), taken: c32(0x2000), notTaken: c32(0x1001) }
      ])
    ]
  });

  strictEqual(result.flagConditions.directConditionCount, 1);
  deepStrictEqual(opNames(result.block), [
    "get32",
    "get32",
    "i32.sub",
    "flags.set",
    "flagProducer.condition",
    "conditionalJump"
  ]);
});

test("flag-condition-specialization emits direct cmp conditional writes", () => {
  const result = specializeJitFlagConditions({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "get32", dst: v(1), source: { kind: "reg", reg: "ebx" } },
        { op: "i32.sub", dst: v(2), a: v(0), b: v(1) },
        createIrFlagSetOp("sub32", { left: v(0), right: v(1), result: v(2) }),
        { op: "aluFlags.condition", dst: v(3), cc: "E" },
        { op: "set32.if", condition: v(3), target: { kind: "reg", reg: "ecx" }, value: c32(1) },
        { op: "next" }
      ])
    ]
  });

  strictEqual(result.flagConditions.directConditionCount, 1);
  strictEqual(opNames(result.block).includes("flagProducer.condition"), true);
});

test("flag-condition-specialization falls back when producer inputs are clobbered", () => {
  const result = specializeJitFlagConditions({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "get32", dst: v(1), source: { kind: "reg", reg: "ebx" } },
        { op: "i32.sub", dst: v(2), a: v(0), b: v(1) },
        createIrFlagSetOp("sub32", { left: v(0), right: v(1), result: v(2) }),
        { op: "next" }
      ]),
      syntheticInstruction([
        { op: "const32", dst: v(0), value: 0 },
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(0) },
        { op: "aluFlags.condition", dst: v(1), cc: "E" },
        { op: "set32.if", condition: v(1), target: { kind: "reg", reg: "ecx" }, value: c32(1) },
        { op: "next" }
      ], 1)
    ]
  });

  strictEqual(result.flagConditions.directConditionCount, 0);
  strictEqual(opNames(result.block).includes("aluFlags.condition"), true);
  strictEqual(opNames(result.block).includes("flagProducer.condition"), false);
});

test("flag-condition-specialization handles supported result-only partial flag conditions", () => {
  const result = specializeJitFlagConditions({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "i32.add", dst: v(1), a: v(0), b: c32(1) },
        createIrFlagSetOp("inc32", { left: v(0), result: v(1) }),
        { op: "aluFlags.condition", dst: v(2), cc: "E" },
        { op: "set32.if", condition: v(2), target: { kind: "reg", reg: "ecx" }, value: c32(1) },
        { op: "next" }
      ])
    ]
  });

  strictEqual(result.flagConditions.directConditionCount, 1);
  strictEqual(opNames(result.block).includes("flagProducer.condition"), true);
});

test("flag-condition-specialization rejects mixed-owner reads", () => {
  const result = specializeJitFlagConditions({
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

  strictEqual(result.flagConditions.directConditionCount, 0);
  strictEqual(opNames(result.block).includes("aluFlags.condition"), true);
});

test("flag-condition-specialization is a validating repeatable optimization pass", () => {
  const first = runJitOptimizationPasses({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "i32.and", dst: v(1), a: v(0), b: c32(0xff) },
        createIrFlagSetOp("logic32", { result: v(1) }),
        { op: "aluFlags.condition", dst: v(2), cc: "E" },
        { op: "set32.if", condition: v(2), target: { kind: "reg", reg: "ecx" }, value: c32(1) },
        { op: "next" }
      ])
    ]
  }, [flagConditionSpecializationPass], { validate: true });
  const second = runJitOptimizationPasses(first.block, [flagConditionSpecializationPass], { validate: true });

  strictEqual(first.changed, true);
  deepStrictEqual(first.passes[0]?.stats, { directConditionCount: 1 });
  strictEqual(second.changed, false);
  deepStrictEqual(second.passes[0]?.stats, { directConditionCount: 0 });
});

function opNames(block: { instructions: readonly { ir: readonly { op: string }[] }[] }): readonly string[] {
  return block.instructions.flatMap((instruction) => instruction.ir.map((op) => op.op));
}
