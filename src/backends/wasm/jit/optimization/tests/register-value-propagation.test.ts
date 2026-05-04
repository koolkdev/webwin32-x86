import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { runJitOptimizationPasses } from "#backends/wasm/jit/optimization/pass.js";
import {
  propagateJitRegisterValues,
  registerValuePropagationPass
} from "#backends/wasm/jit/optimization/passes/register-value-propagation.js";
import { c32, syntheticInstruction, v } from "./helpers.js";

test("register-value-propagation folds register reads and materializes before exits", () => {
  const result = propagateJitRegisterValues({
    instructions: [
      syntheticInstruction([
        { op: "const32", dst: v(0), value: 7 },
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(0) },
        { op: "get32", dst: v(1), source: { kind: "reg", reg: "eax" } },
        { op: "next" }
      ], 0, "exit")
    ]
  });

  deepStrictEqual(result.registerValuePropagation, {
    removedSetCount: 1,
    foldedReadCount: 1,
    foldedAddressCount: 0,
    materializedSetCount: 1
  });
  deepStrictEqual(opNames(result.block), ["const32", "const32", "set32:registerMaterialization", "next"]);
});

test("register-value-propagation inserts materialization before pre-instruction fault points", () => {
  const result = propagateJitRegisterValues({
    instructions: [
      syntheticInstruction([
        { op: "const32", dst: v(0), value: 7 },
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(0) },
        { op: "next" }
      ]),
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "mem", address: c32(0x2000) } },
        { op: "next" }
      ], 1, "exit")
    ]
  });

  deepStrictEqual(opNames({ instructions: [result.block.instructions[1]!] }), [
    "set32:registerMaterialization",
    "get32",
    "next"
  ]);
  strictEqual(result.registerValuePropagation.materializedSetCount, 1);
});

test("register-value-propagation materializes dependencies before clobbers", () => {
  const result = propagateJitRegisterValues({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "set32", target: { kind: "reg", reg: "ebx" }, value: v(0) },
        { op: "const32", dst: v(1), value: 0 },
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(1) },
        { op: "next" }
      ], 0, "exit")
    ]
  });

  deepStrictEqual(opNames(result.block), ["get32", "const32", "set32:registerMaterialization", "set32", "next"]);
  deepStrictEqual(set32Regs(result.block), ["ebx", "eax"]);
  strictEqual(result.registerValuePropagation.removedSetCount, 1);
  strictEqual(result.registerValuePropagation.materializedSetCount, 1);
});

test("register-value-propagation is a validating repeatable optimization pass", () => {
  const first = runJitOptimizationPasses({
    instructions: [
      syntheticInstruction([
        { op: "const32", dst: v(0), value: 7 },
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(0) },
        { op: "get32", dst: v(1), source: { kind: "reg", reg: "eax" } },
        { op: "next" }
      ], 0, "exit")
    ]
  }, [registerValuePropagationPass], { validate: true });
  const second = runJitOptimizationPasses(first.block, [registerValuePropagationPass], { validate: true });

  strictEqual(first.changed, true);
  deepStrictEqual(first.passes[0]?.stats, {
    removedSetCount: 1,
    foldedReadCount: 1,
    foldedAddressCount: 0,
    materializedSetCount: 1
  });
  strictEqual(second.changed, false);
  deepStrictEqual(second.passes[0]?.stats, {
    removedSetCount: 0,
    foldedReadCount: 0,
    foldedAddressCount: 0,
    materializedSetCount: 0
  });
});

function opNames(block: { instructions: readonly { ir: readonly { op: string; role?: string }[] }[] }): readonly string[] {
  return block.instructions.flatMap((instruction) =>
    instruction.ir.map((op) => op.role === undefined ? op.op : `${op.op}:${op.role}`)
  );
}

function set32Regs(block: { instructions: readonly { ir: readonly { op: string; target?: { kind: string; reg?: string } }[] }[] }): readonly string[] {
  return block.instructions.flatMap((instruction) =>
    instruction.ir.flatMap((op) =>
      op.op === "set32" && op.target?.kind === "reg"
        ? [op.target.reg ?? ""]
        : []
    )
  );
}
