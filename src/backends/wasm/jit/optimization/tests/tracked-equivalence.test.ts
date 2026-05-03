import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { ok, decodeBytes } from "#x86/isa/decoder/tests/helpers.js";
import { createIrFlagSetOp } from "#x86/ir/model/flags.js";
import { IR_ALU_FLAG_MASK } from "#x86/ir/model/flag-effects.js";
import { ExitReason } from "#backends/wasm/exit.js";
import { buildJitIrBlock } from "#backends/wasm/jit/block.js";
import { optimizeJitIrBlock } from "#backends/wasm/jit/optimization/optimize.js";
import { runJitIrOptimizationPipeline } from "#backends/wasm/jit/optimization/pipeline.js";
import {
  c32,
  onlyExit,
  set32TargetRegs,
  startAddress,
  syntheticInstruction,
  v
} from "./helpers.js";

test("shared tracked model preserves flag producer removal", () => {
  const cmp = ok(decodeBytes([0x39, 0xd8], startAddress));
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], cmp.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], add.nextEip));
  const result = runJitIrOptimizationPipeline(buildJitIrBlock([cmp, add, trap]));
  const flagSets = result.block.instructions.flatMap((instruction) =>
    instruction.ir.filter((op) => op.op === "flags.set")
  );

  strictEqual(result.passes.flagMaterialization.removedSetCount, 1);
  strictEqual(result.passes.flagMaterialization.retainedSetCount, 1);
  deepStrictEqual(flagSets.map((op) => op.op === "flags.set" ? op.producer : undefined), ["add32"]);
});

test("shared tracked model preserves direct flag conditions", () => {
  const cmp = ok(decodeBytes([0x39, 0xd8], startAddress));
  const cmove = ok(decodeBytes([0x0f, 0x44, 0xca], cmp.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], cmove.nextEip));
  const result = runJitIrOptimizationPipeline(buildJitIrBlock([cmp, cmove, trap]));
  const cmovIr = result.block.instructions[1]!.ir;

  strictEqual(result.passes.flagMaterialization.directConditionCount, 1);
  strictEqual(cmovIr.some((op) => op.op === "aluFlags.condition"), false);
  strictEqual(cmovIr.some((op) => op.op === "jit.flagCondition"), true);
});

test("shared tracked model preserves register set folding", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const xorEax = ok(decodeBytes([0x83, 0xf0, 0x02], movEaxEcx.nextEip));
  const addEbxEax = ok(decodeBytes([0x01, 0xc3], xorEax.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], addEbxEax.nextEip));
  const result = runJitIrOptimizationPipeline(buildJitIrBlock([
    movEaxEcx,
    xorEax,
    addEbxEax,
    trap
  ]));

  strictEqual(result.passes.registerFolding.removedSetCount, 3);
  deepStrictEqual(set32TargetRegs(result.block.instructions), ["eax", "ebx"]);
});

test("shared tracked model preserves exit materialization", () => {
  const movEax = ok(decodeBytes([0xb8, 0x01, 0x00, 0x00, 0x00], startAddress));
  const trap = ok(decodeBytes([0xcd, 0x2e], movEax.nextEip));
  const result = runJitIrOptimizationPipeline(buildJitIrBlock([movEax, trap]));

  strictEqual(result.passes.registerFolding.removedSetCount, 1);
  strictEqual(result.passes.registerFolding.materializedSetCount, 1);
  deepStrictEqual(set32TargetRegs(result.block.instructions), ["eax"]);
});

test("shared tracked model preserves pre-instruction fault snapshots", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const load = ok(decodeBytes([0x8b, 0x05, 0x00, 0x00, 0x01, 0x00], add.nextEip));
  const optimization = optimizeJitIrBlock(buildJitIrBlock([add, load]));
  const exit = onlyExit(optimization.exitPoints, ExitReason.MEMORY_READ_FAULT);

  strictEqual(exit.snapshot.kind, "preInstruction");
  strictEqual(exit.snapshot.eip, load.address);
  strictEqual(exit.exitStateIndex, 1);
  deepStrictEqual(exit.snapshot.committedRegs, ["eax"]);
  strictEqual(exit.snapshot.speculativeFlags.mask, IR_ALU_FLAG_MASK);
  strictEqual(exit.requiredFlagCommitMask, IR_ALU_FLAG_MASK);
});

test("shared tracked model preserves register clobbers that block direct flag reuse", () => {
  const result = runJitIrOptimizationPipeline({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "get32", dst: v(1), source: { kind: "reg", reg: "ebx" } },
        { op: "i32.sub", dst: v(2), a: v(0), b: v(1) },
        createIrFlagSetOp("sub32", { left: v(0), right: v(1), result: v(2) }),
        { op: "next" }
      ], 0),
      syntheticInstruction([
        { op: "const32", dst: v(0), value: 0 },
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(0) },
        { op: "aluFlags.condition", dst: v(1), cc: "E" },
        { op: "set32.if", condition: v(1), target: { kind: "reg", reg: "ecx" }, value: c32(1) },
        { op: "next" }
      ], 1),
      syntheticInstruction([
        { op: "hostTrap", vector: c32(0x2e) }
      ], 2)
    ]
  });
  const ops = result.block.instructions.flatMap((instruction) => instruction.ir);

  strictEqual(result.passes.flagMaterialization.sourceClobberCount, 1);
  strictEqual(result.passes.flagMaterialization.retainedSetCount, 1);
  strictEqual(result.passes.flagMaterialization.directConditionCount, 0);
  strictEqual(ops.some((op) => op.op === "flags.set"), true);
  strictEqual(ops.some((op) => op.op === "jit.flagCondition"), false);
});
