import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { ok, decodeBytes } from "#x86/isa/decoder/tests/helpers.js";
import { buildJitIrBlock } from "#backends/wasm/jit/block.js";
import {
  jitIrOptimizationPassOrder,
  runJitIrOptimizationPipeline
} from "#backends/wasm/jit/optimization/pipeline.js";
import { startAddress } from "./helpers.js";

test("runJitIrOptimizationPipeline exposes ordered transform results", () => {
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

  deepStrictEqual(jitIrOptimizationPassOrder, ["virtual-flags", "dead-local-values", "virtual-registers"]);
  strictEqual(result.passes.virtualFlags.removedSetCount, 1);
  strictEqual(result.passes.deadLocalValues.removedOpCount, 0);
  strictEqual(result.passes.virtualRegisters.removedSetCount, 3);
});

test("runJitIrOptimizationPipeline prunes dead flag producer inputs before virtual registers", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const xorEax = ok(decodeBytes([0x83, 0xf0, 0x02], movEaxEcx.nextEip));
  const cmpEaxZero = ok(decodeBytes([0x83, 0xf8, 0x00], xorEax.nextEip));
  const cmoveEbxEdx = ok(decodeBytes([0x0f, 0x44, 0xda], cmpEaxZero.nextEip));
  const movEaxZero = ok(decodeBytes([0xb8, 0x00, 0x00, 0x00, 0x00], cmoveEbxEdx.nextEip));
  const xorEsi = ok(decodeBytes([0x31, 0xf6], movEaxZero.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], xorEsi.nextEip));
  const result = runJitIrOptimizationPipeline(buildJitIrBlock([
    movEaxEcx,
    xorEax,
    cmpEaxZero,
    cmoveEbxEdx,
    movEaxZero,
    xorEsi,
    trap
  ]));
  const cmpInstruction = result.block.instructions[2]!;
  const cmoveInstruction = result.block.instructions[3]!;

  strictEqual(result.passes.virtualFlags.directConditionCount, 1);
  strictEqual(result.passes.deadLocalValues.removedOpCount, 3);
  deepStrictEqual(cmpInstruction.ir.map((op) => op.op), ["next"]);
  strictEqual(cmoveInstruction.ir.some((op) =>
    op.op === "set32" && op.target.kind === "reg" && op.target.reg === "eax"
  ), false);
  strictEqual(cmoveInstruction.ir.some((op) => op.op === "flagProducer.condition"), true);
});
