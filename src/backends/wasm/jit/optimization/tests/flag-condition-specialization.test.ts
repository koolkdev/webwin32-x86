import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { ok, decodeBytes } from "#x86/isa/decoder/tests/helpers.js";
import type { ConditionCode } from "#x86/ir/model/types.js";
import { createIrFlagSetOp } from "#x86/ir/model/flags.js";
import { buildJitIrBlock } from "#backends/wasm/jit/block.js";
import type { JitIrBlock, JitIrOp } from "#backends/wasm/jit/types.js";
import { flagConditionSpecializationPass, specializeJitFlagConditions } from "#backends/wasm/jit/optimization/passes/flag-condition-specialization.js";
import { runJitOptimizationPasses } from "#backends/wasm/jit/optimization/pass.js";
import { c32, logic32LocalConditionBlock, startAddress, syntheticInstruction, v } from "./helpers.js";

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
  strictEqual(opNames(result.block).includes("flagProducer.condition"), true);
  strictEqual(opNames(result.block).includes("aluFlags.condition"), false);
  strictEqual(opNames(result.block).includes("conditionalJump"), true);
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

test("flag-condition-specialization emits result conditions from writeback registers", () => {
  const result = specializeJitFlagConditions({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "i32.add", dst: v(1), a: v(0), b: c32(1) },
        createIrFlagSetOp("add32", { left: v(0), right: c32(1), result: v(1) }),
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(1) },
        { op: "next" }
      ]),
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "i32.add", dst: v(1), a: v(0), b: c32(1) },
        createIrFlagSetOp("inc32", { left: v(0), result: v(1) }),
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(1) },
        { op: "next" }
      ], 1),
      syntheticInstruction([
        { op: "aluFlags.condition", dst: v(0), cc: "E" },
        { op: "set32.if", condition: v(0), target: { kind: "reg", reg: "ecx" }, value: c32(1) },
        { op: "next" }
      ], 2)
    ]
  });
  const conditionInstruction = result.block.instructions[2]!;
  const condition = singleDirectCondition(result.block);

  strictEqual(result.flagConditions.directConditionCount, 1);
  strictEqual(conditionInstruction.ir.some((op) => op.op === "aluFlags.condition"), false);
  strictEqual(condition.producer, "inc32");
  strictEqual(condition.cc, "E");
  deepStrictEqual(condition.inputs, { result: v(1) });
  strictEqual(conditionInstruction.ir.some((op) =>
    op.op === "get32" && op.source.kind === "reg" && op.source.reg === "eax"
  ), true);
});

test("flag-condition-specialization emits sub32 equality from writeback registers", () => {
  const result = specializeJitFlagConditions({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "i32.sub", dst: v(1), a: v(0), b: c32(1) },
        createIrFlagSetOp("sub32", { left: v(0), right: c32(1), result: v(1) }),
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(1) },
        { op: "next" }
      ]),
      syntheticInstruction([
        { op: "aluFlags.condition", dst: v(0), cc: "E" },
        { op: "set32.if", condition: v(0), target: { kind: "reg", reg: "ecx" }, value: c32(1) },
        { op: "next" }
      ], 1)
    ]
  });
  const condition = singleDirectCondition(result.block);

  strictEqual(result.flagConditions.directConditionCount, 1);
  strictEqual(condition.producer, "sub32");
  strictEqual(condition.cc, "E");
  deepStrictEqual(condition.inputs, { result: v(1) });
});

test("flag-condition-specialization handles decoded cmovcc writeback results", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const inc = ok(decodeBytes([0x40], add.nextEip));
  const cmove = ok(decodeBytes([0x0f, 0x44, 0xca], inc.nextEip));
  const xor = ok(decodeBytes([0x31, 0xf6], cmove.nextEip));
  const result = specializeJitFlagConditions(buildJitIrBlock([add, inc, cmove, xor]));
  const condition = singleDirectCondition(result.block);

  strictEqual(result.flagConditions.directConditionCount, 1);
  strictEqual(condition.producer, "inc32");
  strictEqual(condition.cc, "E");
  deepStrictEqual(condition.inputs, { result: v(2) });
});

test("flag-condition-specialization supports logic32 condition variants", () => {
  const cases: readonly Readonly<{ cc: ConditionCode; resultInput: boolean }>[] = [
    { cc: "O", resultInput: false },
    { cc: "NO", resultInput: false },
    { cc: "B", resultInput: false },
    { cc: "AE", resultInput: false },
    { cc: "E", resultInput: true },
    { cc: "NE", resultInput: true },
    { cc: "BE", resultInput: true },
    { cc: "A", resultInput: true },
    { cc: "L", resultInput: true },
    { cc: "GE", resultInput: true },
    { cc: "LE", resultInput: true },
    { cc: "G", resultInput: true }
  ];

  for (const { cc, resultInput } of cases) {
    const result = specializeJitFlagConditions(logic32LocalConditionBlock(cc));
    const condition = singleDirectCondition(result.block);

    strictEqual(result.flagConditions.directConditionCount, 1, cc);
    strictEqual(condition.producer, "logic32", cc);
    strictEqual(condition.cc, cc);
    deepStrictEqual(condition.inputs, resultInput ? { result: v(1) } : {}, cc);
  }
});

test("flag-condition-specialization emits decoded branch conditions from partial writebacks", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const inc = ok(decodeBytes([0x40], add.nextEip));
  const je = ok(decodeBytes([0x74, 0x05], inc.nextEip));
  const result = specializeJitFlagConditions(buildJitIrBlock([add, inc, je]));
  const condition = singleDirectCondition(result.block);
  const branchIr = result.block.instructions[2]!.ir;

  strictEqual(result.flagConditions.directConditionCount, 1);
  strictEqual(branchIr.some((op) => op.op === "aluFlags.condition"), false);
  strictEqual(condition.producer, "inc32");
  strictEqual(condition.cc, "E");
  deepStrictEqual(condition.inputs, { result: v(2) });
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

type DirectFlagConditionOp = Extract<JitIrOp, { op: "flagProducer.condition" }>;

function singleDirectCondition(block: JitIrBlock): DirectFlagConditionOp {
  const conditions = block.instructions.flatMap((instruction) =>
    instruction.ir.flatMap((op) => op.op === "flagProducer.condition" ? [op] : [])
  );

  strictEqual(conditions.length, 1);
  return conditions[0]!;
}
