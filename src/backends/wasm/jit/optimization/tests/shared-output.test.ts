import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import type { Reg32 } from "#x86/isa/types.js";
import { ok, decodeBytes } from "#x86/isa/decoder/tests/helpers.js";
import { createIrFlagSetOp } from "#x86/ir/model/flags.js";
import { buildJitIrBlock } from "#backends/wasm/jit/block.js";
import type { JitIrBlock, JitIrBody, JitIrOp, JitOptimizedIrBlockInstruction } from "#backends/wasm/jit/types.js";
import { materializeJitFlags } from "#backends/wasm/jit/optimization/flags/materialization.js";
import { foldJitRegisters } from "#backends/wasm/jit/optimization/passes/register-folding.js";
import { runJitIrOptimizationPipeline } from "#backends/wasm/jit/optimization/pipeline.js";
import {
  c32,
  set32TargetRegs,
  startAddress,
  syntheticInstruction,
  v
} from "./helpers.js";

test("shared output retains flag producers required by exits", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const trap = ok(decodeBytes([0xcd, 0x2e], add.nextEip));
  const materialized = materializeJitFlags(buildJitIrBlock([add, trap]));

  strictEqual(materialized.flags.removedSetCount, 0);
  strictEqual(materialized.flags.retainedSetCount, 1);
  deepStrictEqual(flagProducerNames(materialized.block), ["add32"]);
});

test("shared output folds direct local flag conditions", () => {
  const materialized = materializeJitFlags({
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

  strictEqual(materialized.flags.directConditionCount, 1);
  strictEqual(materialized.flags.removedSetCount, 1);
  deepStrictEqual(opNames(materialized.block.instructions[0]!.ir), [
    "get32",
    "get32",
    "i32.sub",
    "get32",
    "get32",
    "jit.flagCondition",
    "set32.if",
    "next"
  ]);
});

test("shared output folds exit flag conditions while retaining snapshot flags", () => {
  const materialized = materializeJitFlags({
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

  strictEqual(materialized.flags.directConditionCount, 1);
  strictEqual(materialized.flags.removedSetCount, 0);
  strictEqual(materialized.flags.retainedSetCount, 1);
  deepStrictEqual(opNames(materialized.block.instructions[0]!.ir), [
    "get32",
    "get32",
    "i32.sub",
    "flags.set",
    "get32",
    "get32",
    "jit.flagCondition",
    "conditionalJump"
  ]);
});

test("shared output falls back when direct flag folding is unsafe", () => {
  const materialized = materializeJitFlags(unsafeFlagConditionBlock());
  const allOps = materialized.block.instructions.flatMap((instruction) => instruction.ir);

  strictEqual(materialized.flags.directConditionCount, 0);
  strictEqual(materialized.flags.retainedSetCount, 1);
  strictEqual(allOps.some((op) => op.op === "flags.set"), true);
  strictEqual(allOps.some((op) => op.op === "aluFlags.condition"), true);
  strictEqual(allOps.some((op) => op.op === "jit.flagCondition"), false);
});

test("shared output folds register get32 reads", () => {
  const folded = foldJitRegisters({
    instructions: [
      syntheticInstruction([
        { op: "const32", dst: v(0), value: 1 },
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(0) },
        { op: "get32", dst: v(1), source: { kind: "reg", reg: "eax" } },
        { op: "next" }
      ]),
      syntheticInstruction([
        { op: "hostTrap", vector: c32(0x2e) }
      ])
    ]
  });

  strictEqual(folded.folding.removedSetCount, 1);
  strictEqual(folded.folding.materializedSetCount, 1);
  strictEqual(folded.block.instructions[0]!.ir.some((op) => op.op === "get32"), false);
  strictEqual(folded.block.instructions[0]!.ir.some((op) => op.op === "set32"), false);
  deepStrictEqual(opNames(folded.block.instructions[0]!.ir), ["const32", "const32", "next"]);
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["eax"]);
});

test("shared output folds register values into effective addresses", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const leaEbx = ok(decodeBytes([0x8d, 0x58, 0x04], movEaxEcx.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], leaEbx.nextEip));
  const folded = foldJitRegisters(buildJitIrBlock([movEaxEcx, leaEbx, trap]));

  strictEqual(folded.folding.removedSetCount, 2);
  strictEqual(folded.block.instructions[1]!.ir.some((op) => op.op === "address32"), false);
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["eax", "ebx"]);
});

test("shared output materializes repeated expensive register reads", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const xorEax = ok(decodeBytes([0x83, 0xf0, 0x02], movEaxEcx.nextEip));
  const addEbxEax = ok(decodeBytes([0x01, 0xc3], xorEax.nextEip));
  const addEdxEax = ok(decodeBytes([0x01, 0xc2], addEbxEax.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], addEdxEax.nextEip));
  const folded = foldJitRegisters(buildJitIrBlock([
    movEaxEcx,
    xorEax,
    addEbxEax,
    addEdxEax,
    trap
  ]));

  strictEqual(folded.folding.materializedSetCount, 3);
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["eax", "ebx", "edx"]);
});

test("shared output materializes dependency clobbers before overwrites", () => {
  const movEbxEax = ok(decodeBytes([0x89, 0xc3], startAddress));
  const movEaxZero = ok(decodeBytes([0xb8, 0x00, 0x00, 0x00, 0x00], movEbxEax.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], movEaxZero.nextEip));
  const folded = foldJitRegisters(buildJitIrBlock([movEbxEax, movEaxZero, trap]));

  strictEqual(folded.folding.materializedSetCount, 2);
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["ebx", "eax"]);
  strictEqual(hasSet32Reg(folded.block.instructions[1]!.ir, "ebx"), true);
});

test("shared output emits pre-instruction fault register materialization in preludes", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const loadFromEax = ok(decodeBytes([0x8b, 0x18], movEaxEcx.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], loadFromEax.nextEip));
  const folded = foldJitRegisters(buildJitIrBlock([movEaxEcx, loadFromEax, trap]));
  const loadInstruction = folded.block.instructions[1]!;

  strictEqual(hasPreludeSet32Reg(loadInstruction, "eax"), true);
  deepStrictEqual(opNames(loadInstruction.prelude), ["get32", "set32"]);
});

test("shared output emits post-instruction exit register materialization before exits", () => {
  const movEax = ok(decodeBytes([0xb8, 0x01, 0x00, 0x00, 0x00], startAddress));
  const trap = ok(decodeBytes([0xcd, 0x2e], movEax.nextEip));
  const folded = foldJitRegisters(buildJitIrBlock([movEax, trap]));
  const trapInstruction = folded.block.instructions[1]!;

  strictEqual(folded.folding.materializedSetCount, 1);
  deepStrictEqual(opNames(trapInstruction.ir), ["get32", "set32", "hostTrap"]);
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["eax"]);
});

test("shared output records register writes invalidating flag producer inputs", () => {
  const optimized = runJitIrOptimizationPipeline(unsafeFlagConditionBlock());
  const allOps = optimized.block.instructions.flatMap((instruction) => instruction.ir);

  strictEqual(optimized.passes.flagMaterialization.sourceClobberCount, 1);
  strictEqual(optimized.passes.flagMaterialization.directConditionCount, 0);
  strictEqual(allOps.some((op) => op.op === "flags.set"), true);
  strictEqual(allOps.some((op) => op.op === "jit.flagCondition"), false);
});

function unsafeFlagConditionBlock(): JitIrBlock {
  return {
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
  };
}

function flagProducerNames(block: JitIrBlock): readonly string[] {
  return block.instructions.flatMap((instruction) =>
    instruction.ir.flatMap((op) => op.op === "flags.set" ? [op.producer] : [])
  );
}

function opNames(ops: JitIrBody): readonly JitIrOp["op"][] {
  return ops.map((op) => op.op);
}

function hasSet32Reg(ops: JitIrBody, reg: Reg32): boolean {
  return ops.some((op) => op.op === "set32" && op.target.kind === "reg" && op.target.reg === reg);
}

function hasPreludeSet32Reg(
  instruction: JitOptimizedIrBlockInstruction,
  reg: Reg32
): boolean {
  return instruction.prelude.some((op) => op.op === "set32" && op.target.kind === "reg" && op.target.reg === reg);
}
