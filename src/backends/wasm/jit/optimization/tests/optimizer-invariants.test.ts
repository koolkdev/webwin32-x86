import { throws } from "node:assert";
import { test } from "node:test";

import { IR_ALU_FLAG_MASK } from "#x86/ir/model/flag-effects.js";
import { FLAG_PRODUCERS } from "#x86/ir/model/flags.js";
import type { JitIrBlock, JitIrBlockInstruction, JitIrBody } from "#backends/wasm/jit/types.js";
import { verifyJitIrBlock } from "#backends/wasm/jit/optimization/verify/optimizer-invariants.js";
import { c32, startAddress, v } from "./helpers.js";

test("verifyJitIrBlock rejects missing JIT flag condition inputs", () => {
  throws(() => verifyJitIrBlock(jitBlock([
    {
      op: "jit.flagCondition",
      dst: v(0),
      cc: "E",
      producer: "sub32",
      writtenMask: IR_ALU_FLAG_MASK,
      undefMask: 0,
      inputs: { right: c32(0) }
    },
    { op: "next" }
  ]), { phase: "final" }), /missing flag producer condition input 'left'/);
});

test("verifyJitIrBlock rejects unexpected JIT flag condition inputs", () => {
  throws(() => verifyJitIrBlock(jitBlock([
    {
      op: "jit.flagCondition",
      dst: v(0),
      cc: "E",
      producer: "logic32",
      writtenMask: FLAG_PRODUCERS.logic32.writtenMask,
      undefMask: FLAG_PRODUCERS.logic32.undefMask,
      inputs: { result: c32(0), left: c32(0) }
    },
    { op: "next" }
  ]), { phase: "final" }), /unexpected input 'left'/);
});

test("verifyJitIrBlock rejects non-register materialization targets", () => {
  throws(() => verifyJitIrBlock(jitBlock([
    {
      op: "set32",
      jitRole: "registerMaterialization",
      target: { kind: "mem", address: c32(0x2000) },
      value: c32(1)
    },
    { op: "next" }
  ]), { phase: "final" }), /register materialization cannot target mem/);
});

function jitBlock(ir: JitIrBody): JitIrBlock {
  return { instructions: [jitInstruction(ir)] };
}

function jitInstruction(ir: JitIrBody): JitIrBlockInstruction {
  return {
    instructionId: "synthetic.verifier",
    eip: startAddress,
    nextEip: startAddress + 1,
    nextMode: "continue",
    operands: [],
    ir
  };
}
