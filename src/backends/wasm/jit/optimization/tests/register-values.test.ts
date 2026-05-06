import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { test } from "node:test";

import { ExitReason } from "#backends/wasm/exit.js";
import { indexJitEffects } from "#backends/wasm/jit/ir/effects.js";
import {
  analyzeJitBarriers,
  jitInstructionBarriersAt,
  jitInstructionHasBarrier,
  jitOpBarriersAt
} from "#backends/wasm/jit/ir/barriers.js";
import {
  analyzeJitRegisterValues,
  validateJitRegisterValueAnalysis,
  type JitRegisterMaterialization,
  type JitRegisterValueAnalysis
} from "#backends/wasm/jit/optimization/analyses/register-values.js";
import { c32, syntheticInstruction, v } from "./helpers.js";

test("register barrier analysis identifies exits and register writes", () => {
  const block = {
    instructions: [
      syntheticInstruction([
        { op: "get", dst: v(0), source: { kind: "mem", address: c32(0x2000) } },
        { op: "set", target: { kind: "reg", reg: "eax" }, value: v(0) },
        { op: "next" }
      ], 0, "exit")
    ]
  };
  const effects = indexJitEffects(block);
  const analysis = analyzeJitBarriers(block, effects);

  strictEqual(analysis.effects, effects);

  deepStrictEqual(analysis.barriers, [
    {
      instructionIndex: 0,
      opIndex: 0,
      reason: "preInstructionExit",
      exitReason: ExitReason.MEMORY_READ_FAULT
    },
    { instructionIndex: 0, opIndex: 1, reason: "write", reg: "eax" },
    {
      instructionIndex: 0,
      opIndex: 2,
      reason: "exit",
      exitReasons: [ExitReason.FALLTHROUGH]
    }
  ]);
  deepStrictEqual(jitInstructionBarriersAt(analysis, 0), analysis.barriers);
  strictEqual(jitInstructionHasBarrier(analysis, 0, "preInstructionExit"), true);
  deepStrictEqual(jitOpBarriersAt(analysis, 0, 0), [
    {
      instructionIndex: 0,
      opIndex: 0,
      reason: "preInstructionExit",
      exitReason: ExitReason.MEMORY_READ_FAULT
    }
  ]);
  deepStrictEqual(jitOpBarriersAt(analysis, 0, 2), [
    {
      instructionIndex: 0,
      opIndex: 2,
      reason: "exit",
      exitReasons: [ExitReason.FALLTHROUGH]
    }
  ]);
});

test("register value analysis tracks foldable register reads", () => {
  const analysis = analyzeJitRegisterValues({
    instructions: [
      syntheticInstruction([
        { op: "value.const", type: "i32", dst: v(0), value: 7 },
        { op: "set", target: { kind: "reg", reg: "eax" }, value: v(0) },
        { op: "get", dst: v(1), source: { kind: "reg", reg: "eax" } },
        { op: "next" }
      ])
    ]
  });

  strictEqual(analysis.producers.length, 1);
  deepStrictEqual(analysis.reads.map((read) => ({
    reg: read.reg,
    folded: read.folded,
    reason: read.reason
  })), [{ reg: "eax", folded: true, reason: "get" }]);
  deepStrictEqual(analysis.folds.map((fold) => ({
    opIndex: fold.opIndex,
    kind: fold.kind,
    regs: fold.regs
  })), [{ opIndex: 2, kind: "get", regs: ["eax"] }]);
  deepStrictEqual(analysis.materializations.map((entry) => ({
    opIndex: entry.opIndex,
    phase: entry.phase,
    reason: entry.reason,
    regs: entry.regs
  })), [{ opIndex: 3, phase: "beforeOp", reason: "blockEnd", regs: ["eax"] }]);
});

test("register value analysis folds low-byte reads from tracked full registers", () => {
  const analysis = analyzeJitRegisterValues({
    instructions: [
      syntheticInstruction([
        { op: "value.const", type: "i32", dst: v(0), value: 0x1234_5678 },
        { op: "set", target: { kind: "reg", reg: "eax" }, value: v(0) },
        { op: "get", dst: v(1), source: { kind: "reg", reg: "eax" }, accessWidth: 8 },
        { op: "next" }
      ])
    ]
  });

  deepStrictEqual(analysis.folds.map((fold) => ({
    opIndex: fold.opIndex,
    kind: fold.kind,
    value: fold.value,
    regs: fold.regs
  })), [{
    opIndex: 2,
    kind: "get",
    value: { kind: "const", type: "i32", value: 0x78 },
    regs: ["eax"]
  }]);
  deepStrictEqual(analysis.materializations.map((entry) => ({
    opIndex: entry.opIndex,
    phase: entry.phase,
    reason: entry.reason,
    regs: entry.regs
  })), [{ opIndex: 3, phase: "beforeOp", reason: "blockEnd", regs: ["eax"] }]);
});

test("register value analysis keeps signed and unsigned low-byte reads distinct", () => {
  const lowByteOfEcx = {
    kind: "value.binary", type: "i32", operator: "and" as const,
    a: { kind: "reg" as const, reg: "ecx" as const },
    b: { kind: "const" as const, type: "i32" as const, value: 0xff }
  };
  const foldedLowByteValue = (signed: boolean) => analyzeJitRegisterValues({
    instructions: [
      syntheticInstruction([
        { op: "get", dst: v(0), source: { kind: "reg", reg: "ecx" } },
        { op: "set", target: { kind: "reg", reg: "eax" }, value: v(0) },
        {
          op: "get",
          dst: v(1),
          source: { kind: "reg", reg: "eax" },
          accessWidth: 8,
          ...(signed ? { signed: true as const } : {})
        },
        { op: "next" }
      ])
    ]
  }).folds[0]?.value;

  deepStrictEqual(foldedLowByteValue(false), lowByteOfEcx);
  deepStrictEqual(foldedLowByteValue(true), { kind: "value.unary", type: "i32", operator: "extend8_s", value: lowByteOfEcx });
});

test("register value analysis folds low-word reads from tracked full registers", () => {
  const analysis = analyzeJitRegisterValues({
    instructions: [
      syntheticInstruction([
        { op: "value.const", type: "i32", dst: v(0), value: 0x1234_5678 },
        { op: "set", target: { kind: "reg", reg: "eax" }, value: v(0) },
        { op: "get", dst: v(1), source: { kind: "reg", reg: "eax" }, accessWidth: 16 },
        { op: "next" }
      ])
    ]
  });

  deepStrictEqual(analysis.folds.map((fold) => ({
    opIndex: fold.opIndex,
    kind: fold.kind,
    value: fold.value,
    regs: fold.regs
  })), [{
    opIndex: 2,
    kind: "get",
    value: { kind: "const", type: "i32", value: 0x5678 },
    regs: ["eax"]
  }]);
  deepStrictEqual(analysis.materializations.map((entry) => ({
    opIndex: entry.opIndex,
    reason: entry.reason,
    regs: entry.regs
  })), [{ opIndex: 3, reason: "blockEnd", regs: ["eax"] }]);
});

test("register value analysis folds same-lane reads after partial writes", () => {
  const analysis = analyzeJitRegisterValues({
    instructions: [
      syntheticInstruction([
        { op: "value.const", type: "i32", dst: v(0), value: 0x44 },
        { op: "set", target: { kind: "reg", reg: "eax" }, value: v(0), accessWidth: 8 },
        { op: "get", dst: v(1), source: { kind: "reg", reg: "eax" }, accessWidth: 8 },
        { op: "next" }
      ])
    ]
  });

  strictEqual(analysis.producers.length, 0);
  deepStrictEqual(analysis.folds.map((fold) => ({
    opIndex: fold.opIndex,
    kind: fold.kind,
    value: fold.value,
    regs: fold.regs
  })), [{
    opIndex: 2,
    kind: "get",
    value: { kind: "const", type: "i32", value: 0x44 },
    regs: ["eax"]
  }]);
  deepStrictEqual(analysis.materializations, []);
  deepStrictEqual([...analysis.finalValues], []);
});

test("register value analysis keeps wider reads after partial-only writes conservative", () => {
  const analysis = analyzeJitRegisterValues({
    instructions: [
      syntheticInstruction([
        { op: "value.const", type: "i32", dst: v(0), value: 0x44 },
        { op: "set", target: { kind: "reg", reg: "eax" }, value: v(0), accessWidth: 8 },
        { op: "get", dst: v(1), source: { kind: "reg", reg: "eax" }, accessWidth: 16 },
        { op: "next" }
      ])
    ]
  });

  deepStrictEqual(analysis.folds, []);
  deepStrictEqual(analysis.materializations, []);
  deepStrictEqual([...analysis.finalValues], []);
});

test("register value analysis materializes dependencies before clobbers", () => {
  const analysis = analyzeJitRegisterValues({
    instructions: [
      syntheticInstruction([
        { op: "get", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "set", target: { kind: "reg", reg: "ebx" }, value: v(0) },
        { op: "value.const", type: "i32", dst: v(1), value: 0 },
        { op: "set", target: { kind: "reg", reg: "eax" }, value: v(1) },
        { op: "next" }
      ])
    ]
  });

  deepStrictEqual(analysis.materializations.map((entry) => ({
    opIndex: entry.opIndex,
    reason: entry.reason,
    regs: entry.regs
  })), [
    { opIndex: 4, reason: "blockEnd", regs: ["eax", "ebx"] }
  ]);
});

test("register value analysis keeps immediately exiting writes concrete", () => {
  const analysis = analyzeJitRegisterValues({
    instructions: [
      syntheticInstruction([
        { op: "value.const", type: "i32", dst: v(0), value: 7 },
        { op: "set", target: { kind: "reg", reg: "eax" }, value: v(0) },
        { op: "next" }
      ], 0, "exit")
    ]
  });

  strictEqual(analysis.producers[0]?.retained, false);
  deepStrictEqual(analysis.materializations, []);
});

test("register value analysis validation rejects missing materialization values", () => {
  throws(() => validateJitRegisterValueAnalysis(analysisWithMaterialization({
    instructionIndex: 0,
    opIndex: 1,
    phase: "beforeOp",
    reason: "clobber",
    regs: ["eax"],
    values: []
  })), /missing values for eax/);
});

test("register value analysis validation rejects mismatched materialization values", () => {
  throws(() => validateJitRegisterValueAnalysis(analysisWithMaterialization({
    instructionIndex: 0,
    opIndex: 1,
    phase: "beforeOp",
    reason: "clobber",
    regs: ["eax"],
    values: [{ reg: "ebx", value: { kind: "const", type: "i32", value: 1 } }]
  })), /unexpected value for ebx/);
});

function analysisWithMaterialization(
  materialization: JitRegisterMaterialization
): JitRegisterValueAnalysis {
  return {
    producers: [],
    reads: [],
    folds: [],
    materializations: [materialization],
    finalValues: new Map()
  };
}
