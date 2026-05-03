import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { analyzeJitRegisterBarriers } from "#backends/wasm/jit/optimization/analyses/barriers.js";
import { analyzeJitRegisterValues } from "#backends/wasm/jit/optimization/analyses/register-values.js";
import { c32, syntheticInstruction, v } from "./helpers.js";

test("register barrier analysis identifies exits and register writes", () => {
  const analysis = analyzeJitRegisterBarriers({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "mem", address: c32(0x2000) } },
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(0) },
        { op: "next" }
      ], 0, "exit")
    ]
  });

  deepStrictEqual(analysis.barriers, [
    { instructionIndex: 0, reason: "preInstructionExit" },
    { instructionIndex: 0, opIndex: 1, reason: "write", reg: "eax" },
    { instructionIndex: 0, opIndex: 2, reason: "exit" }
  ]);
});

test("register value analysis tracks foldable register reads", () => {
  const analysis = analyzeJitRegisterValues({
    instructions: [
      syntheticInstruction([
        { op: "const32", dst: v(0), value: 7 },
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(0) },
        { op: "get32", dst: v(1), source: { kind: "reg", reg: "eax" } },
        { op: "next" }
      ])
    ]
  });

  strictEqual(analysis.producers.length, 1);
  deepStrictEqual(analysis.reads.map((read) => ({
    reg: read.reg,
    folded: read.folded,
    reason: read.reason
  })), [{ reg: "eax", folded: true, reason: "get32" }]);
  deepStrictEqual(analysis.folds.map((fold) => ({
    opIndex: fold.opIndex,
    kind: fold.kind,
    regs: fold.regs
  })), [{ opIndex: 2, kind: "get32", regs: ["eax"] }]);
  deepStrictEqual(analysis.materializations.map((entry) => ({
    opIndex: entry.opIndex,
    phase: entry.phase,
    reason: entry.reason,
    regs: entry.regs
  })), [{ opIndex: 3, phase: "beforeOp", reason: "blockEnd", regs: ["eax"] }]);
});

test("register value analysis materializes dependencies before clobbers", () => {
  const analysis = analyzeJitRegisterValues({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "set32", target: { kind: "reg", reg: "ebx" }, value: v(0) },
        { op: "const32", dst: v(1), value: 0 },
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(1) },
        { op: "next" }
      ])
    ]
  });

  deepStrictEqual(analysis.materializations.map((entry) => ({
    opIndex: entry.opIndex,
    reason: entry.reason,
    regs: entry.regs
  })), [
    { opIndex: 3, reason: "clobber", regs: ["ebx"] },
    { opIndex: 4, reason: "blockEnd", regs: ["eax"] }
  ]);
});

test("register value analysis keeps immediately exiting writes concrete", () => {
  const analysis = analyzeJitRegisterValues({
    instructions: [
      syntheticInstruction([
        { op: "const32", dst: v(0), value: 7 },
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(0) },
        { op: "next" }
      ], 0, "exit")
    ]
  });

  strictEqual(analysis.producers[0]?.retained, false);
  deepStrictEqual(analysis.materializations, []);
});
