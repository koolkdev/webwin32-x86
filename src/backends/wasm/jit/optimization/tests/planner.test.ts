import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { ok, decodeBytes } from "#x86/isa/decoder/tests/helpers.js";
import { createIrFlagSetOp } from "#x86/ir/model/flags.js";
import { IR_ALU_FLAG_MASKS } from "#x86/ir/model/flag-effects.js";
import { buildJitIrBlock } from "#backends/wasm/jit/block.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { analyzeJitOptimization } from "#backends/wasm/jit/optimization/tracked/analysis.js";
import {
  planJitFlagMaterialization,
  planJitRegisterFolding
} from "#backends/wasm/jit/optimization/planner/emitter.js";
import type { JitOptimizationPlanRecord, PlannedMaterialization } from "#backends/wasm/jit/optimization/planner/plan.js";
import { runTrackedJitOptimization } from "#backends/wasm/jit/optimization/planner/planner.js";
import { pruneDeadJitLocalValues } from "#backends/wasm/jit/optimization/passes/dead-local-values.js";
import { materializeJitFlags } from "#backends/wasm/jit/optimization/flags/materialization.js";
import type { JitIrOptimizationPipelineResult } from "#backends/wasm/jit/optimization/pipeline.js";
import { foldJitRegisters } from "#backends/wasm/jit/optimization/passes/register-folding.js";
import {
  c32,
  startAddress,
  syntheticInstruction,
  v
} from "./helpers.js";

test("tracked optimizer matches the production pipeline for direct flag and register folding", () => {
  const cmp = ok(decodeBytes([0x39, 0xd8], startAddress));
  const cmove = ok(decodeBytes([0x0f, 0x44, 0xca], cmp.nextEip));
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], cmove.nextEip));
  const xorEax = ok(decodeBytes([0x83, 0xf0, 0x02], movEaxEcx.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], xorEax.nextEip));
  const block = buildJitIrBlock([cmp, cmove, movEaxEcx, xorEax, trap]);
  const tracked = runTrackedJitOptimization(block);
  const separate = runSeparateOptimizationPasses(block);

  deepStrictEqual(tracked.block, separate.block);
  deepStrictEqual(tracked.passes, separate.passes);
  deepStrictEqual(tracked.plan.stats, tracked.tracking);
  strictEqual(tracked.tracking.instructionsWalked, block.instructions.length);
  strictEqual(tracked.tracking.flagSourceCount > 0, true);
  strictEqual(tracked.tracking.registerProducerCount > 0, true);
  strictEqual(tracked.plan.records.some((record) => record.kind === "producer"), true);
  strictEqual(tracked.plan.records.some((record) => record.kind === "read"), true);
});

test("tracked optimizer matches the production pipeline for flag/register clobbers", () => {
  const block = {
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
  const tracked = runTrackedJitOptimization(block);
  const separate = runSeparateOptimizationPasses(block);

  deepStrictEqual(tracked.block, separate.block);
  deepStrictEqual(tracked.passes, separate.passes);
  strictEqual(tracked.tracking.instructionsWalked, block.instructions.length);
  strictEqual(tracked.tracking.sourceClobberCount, 1);
  strictEqual(tracked.plan.records.some((record) => record.kind === "clobber"), true);
});

test("planner records register materialization reasons explicitly", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const movEbxEax = ok(decodeBytes([0x89, 0xc3], movEaxEcx.nextEip));
  const xorEax = ok(decodeBytes([0x83, 0xf0, 0x02], movEaxEcx.nextEip));
  const addEbxEax = ok(decodeBytes([0x01, 0xc3], xorEax.nextEip));
  const addEdxEax = ok(decodeBytes([0x01, 0xc2], addEbxEax.nextEip));
  const movEaxZero = ok(decodeBytes([0xb8, 0x00, 0x00, 0x00, 0x00], addEbxEax.nextEip));
  const movEaxZeroAfterMov = ok(decodeBytes([0xb8, 0x00, 0x00, 0x00, 0x00], movEbxEax.nextEip));
  const scaledLea = ok(decodeBytes([0x8d, 0x1c, 0x45, 0x04, 0x00, 0x00, 0x00], movEaxEcx.nextEip));
  const loadFromEax = ok(decodeBytes([0x8b, 0x18], movEaxEcx.nextEip));
  const movEax = ok(decodeBytes([0xb8, 0x01, 0x00, 0x00, 0x00], startAddress));
  const trap = ok(decodeBytes([0xcd, 0x2e], addEdxEax.nextEip));
  const repeated = registerMaterializationReasons(buildJitIrBlock([
    movEaxEcx,
    xorEax,
    addEbxEax,
    addEdxEax,
    trap
  ]));
  const clobber = registerMaterializationReasons(buildJitIrBlock([
    movEbxEax,
    movEaxZeroAfterMov,
    trap
  ]));
  const readFallback = registerMaterializationReasons(buildJitIrBlock([
    movEaxEcx,
    scaledLea,
    trap
  ]));
  const preInstructionExit = registerMaterializationPhases(buildJitIrBlock([
    movEaxEcx,
    loadFromEax,
    trap
  ]));
  const postInstructionExit = registerMaterializationPhases(buildJitIrBlock([movEax, trap]));

  strictEqual(repeated.has("policy"), true);
  strictEqual(readFallback.has("read"), true);
  strictEqual(clobber.has("clobber"), true);
  strictEqual(preInstructionExit.has("prelude:preInstructionExit"), true);
  strictEqual(postInstructionExit.has("beforeExit:exit"), true);
});

test("planner records flag materialization reasons explicitly", () => {
  const addMem = ok(decodeBytes([0x01, 0x18], startAddress));
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const trap = ok(decodeBytes([0xcd, 0x2e], add.nextEip));
  const explicit = flagMaterializationReasons({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "i32.add", dst: v(1), a: v(0), b: c32(1) },
        createIrFlagSetOp("add32", { left: v(0), right: c32(1), result: v(1) }),
        { op: "flags.materialize", mask: IR_ALU_FLAG_MASKS.ZF },
        { op: "flags.boundary", mask: IR_ALU_FLAG_MASKS.CF },
        { op: "next" }
      ])
    ]
  });
  const exit = flagMaterializationPhases(buildJitIrBlock([add, trap]));
  const preInstruction = flagMaterializationPhases(buildJitIrBlock([addMem]));
  const conditionFallback = flagMaterializationReasons(flagConditionFallbackBlock());

  strictEqual(explicit.has("materialize"), true);
  strictEqual(explicit.has("boundary"), true);
  strictEqual(exit.has("beforeExit:exit"), true);
  strictEqual(preInstruction.has("prelude:preInstructionExit"), true);
  strictEqual(conditionFallback.has("condition"), true);
});

function runSeparateOptimizationPasses(block: JitIrBlock): JitIrOptimizationPipelineResult {
  const initialAnalysis = analyzeJitOptimization(block);
  const flagMaterialization = materializeJitFlags(block, initialAnalysis);
  const deadLocalValues = pruneDeadJitLocalValues(flagMaterialization.block);
  const registerAnalysis = analyzeJitOptimization(deadLocalValues.block);
  const registerFolding = foldJitRegisters(deadLocalValues.block, registerAnalysis);

  return {
    block: registerFolding.block,
    passes: {
      flagMaterialization: flagMaterialization.flags,
      deadLocalValues: deadLocalValues.deadLocalValues,
      registerFolding: registerFolding.folding
    }
  };
}

function registerMaterializationReasons(block: JitIrBlock): ReadonlySet<string> {
  return new Set(registerMaterializations(block).map((record) => record.reason));
}

function registerMaterializationPhases(block: JitIrBlock): ReadonlySet<string> {
  return new Set(registerMaterializations(block).map((record) => `${record.phase}:${record.reason}`));
}

function registerMaterializations(block: JitIrBlock) {
  return planJitRegisterFolding(block, analyzeJitOptimization(block)).records.filter(isRegisterMaterialization);
}

function flagMaterializationReasons(block: JitIrBlock): ReadonlySet<string> {
  return new Set(flagMaterializations(block).map((record) => record.reason));
}

function flagMaterializationPhases(block: JitIrBlock): ReadonlySet<string> {
  return new Set(flagMaterializations(block).map((record) => `${record.phase}:${record.reason}`));
}

function flagMaterializations(block: JitIrBlock) {
  return planJitFlagMaterialization(block, analyzeJitOptimization(block)).records.filter(isFlagMaterialization);
}

function isRegisterMaterialization(record: JitOptimizationPlanRecord): record is PlannedMaterialization {
  return record.kind === "materialization" && record.domain === "registers";
}

function isFlagMaterialization(record: JitOptimizationPlanRecord): record is PlannedMaterialization {
  return record.kind === "materialization" && record.domain === "flags";
}

function flagConditionFallbackBlock(): JitIrBlock {
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
      ], 1)
    ]
  };
}
