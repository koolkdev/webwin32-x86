import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { ok, decodeBytes } from "#x86/isa/decoder/tests/helpers.js";
import { createIrFlagSetOp } from "#x86/ir/model/flags.js";
import { buildJitIrBlock } from "#backends/wasm/jit/block.js";
import { runDraftCombinedJitOptimization } from "#backends/wasm/jit/optimization/combined.js";
import { runJitIrOptimizationPipeline } from "#backends/wasm/jit/optimization/pipeline.js";
import {
  c32,
  startAddress,
  syntheticInstruction,
  v
} from "./helpers.js";

test("draft combined optimizer matches the production pipeline for direct flag and register folding", () => {
  const cmp = ok(decodeBytes([0x39, 0xd8], startAddress));
  const cmove = ok(decodeBytes([0x0f, 0x44, 0xca], cmp.nextEip));
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], cmove.nextEip));
  const xorEax = ok(decodeBytes([0x83, 0xf0, 0x02], movEaxEcx.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], xorEax.nextEip));
  const block = buildJitIrBlock([cmp, cmove, movEaxEcx, xorEax, trap]);
  const draft = runDraftCombinedJitOptimization(block);
  const production = runJitIrOptimizationPipeline(block);

  deepStrictEqual(draft.block, production.block);
  deepStrictEqual(draft.passes, production.passes);
  strictEqual(draft.combinedTracking.instructionsWalked, block.instructions.length);
  strictEqual(draft.combinedTracking.flagSourceCount > 0, true);
  strictEqual(draft.combinedTracking.registerProducerCount > 0, true);
});

test("draft combined optimizer matches the production pipeline for flag/register clobbers", () => {
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
  const draft = runDraftCombinedJitOptimization(block);
  const production = runJitIrOptimizationPipeline(block);

  deepStrictEqual(draft.block, production.block);
  deepStrictEqual(draft.passes, production.passes);
  strictEqual(draft.combinedTracking.instructionsWalked, block.instructions.length);
  strictEqual(draft.combinedTracking.sourceClobberCount, 1);
});
