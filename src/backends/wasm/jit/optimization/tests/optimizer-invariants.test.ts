import { throws } from "node:assert";
import { test } from "node:test";

import { IR_ALU_FLAG_MASK } from "#x86/ir/model/flag-effects.js";
import { FLAG_PRODUCERS } from "#x86/ir/model/flags.js";
import { validateJitIrBlock } from "#backends/wasm/jit/ir/validate.js";
import type { JitIrBlock, JitIrBlockInstruction, JitIrBody } from "#backends/wasm/jit/ir/types.js";
import { c32, startAddress, v } from "./helpers.js";

test("validateJitIrBlock rejects missing JIT flag condition inputs", () => {
  throws(() => validateJitIrBlock(jitBlock([
    {
      op: "flagProducer.condition",
      dst: v(0),
      cc: "E",
      producer: "sub32",
      writtenMask: IR_ALU_FLAG_MASK,
      undefMask: 0,
      inputs: { right: c32(0) }
    },
    { op: "next" }
  ])), /missing flag producer condition input 'left'/);
});

test("validateJitIrBlock rejects JIT flag condition inputs used before definition", () => {
  throws(() => validateJitIrBlock(jitBlock([
    {
      op: "flagProducer.condition",
      dst: v(0),
      cc: "E",
      producer: "sub32",
      writtenMask: IR_ALU_FLAG_MASK,
      undefMask: 0,
      inputs: { left: v(1), right: c32(0) }
    },
    { op: "next" }
  ])), /JIT IR var 1 is used before definition/);
});

test("validateJitIrBlock rejects operand indexes before effect analysis", () => {
  throws(() => validateJitIrBlock(jitBlock([
    { op: "get32", dst: v(0), source: { kind: "operand", index: 0 } },
    { op: "next" }
  ])), /IR operand 0 does not exist in 0-operand instruction/);
});

test("validateJitIrBlock rejects unexpected JIT flag condition inputs", () => {
  throws(() => validateJitIrBlock(jitBlock([
    {
      op: "flagProducer.condition",
      dst: v(0),
      cc: "E",
      producer: "logic32",
      writtenMask: FLAG_PRODUCERS.logic32.writtenMask,
      undefMask: FLAG_PRODUCERS.logic32.undefMask,
      inputs: { result: c32(0), left: c32(0) }
    },
    { op: "next" }
  ])), /unexpected input 'left'/);
});

test("validateJitIrBlock rejects non-register materialization targets", () => {
  throws(() => validateJitIrBlock(jitBlock([
    {
      op: "set32",
      role: "registerMaterialization",
      target: { kind: "mem", address: c32(0x2000) },
      value: c32(1)
    },
    { op: "next" }
  ])), /register materialization cannot target mem/);
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
