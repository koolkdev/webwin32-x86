import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { IR_ALU_FLAG_MASK, IR_ALU_FLAG_MASKS } from "#x86/ir/model/flag-effects.js";
import { analyzeJitOptimization } from "#backends/wasm/jit/optimization/analysis.js";
import type { JitFlagSource } from "#backends/wasm/jit/optimization/flags.js";
import { createJitPreludeRewrite } from "#backends/wasm/jit/optimization/rewrite.js";
import { JitTrackedState } from "#backends/wasm/jit/optimization/tracked-state.js";
import { syntheticInstruction } from "./helpers.js";

test("JitTrackedState records register producers, reads, and clobbers", () => {
  const state = new JitTrackedState(analyzeJitOptimization({ instructions: [] }).context);
  const value = { kind: "const32" as const, value: 7 };
  const location = { kind: "register" as const, reg: "eax" as const };

  state.recordProducer({
    location,
    producer: { kind: "registerValue", value }
  });

  deepStrictEqual(state.recordRead({ location, reason: "read" }), {
    location,
    reason: "read",
    producers: [{ location, producer: { kind: "registerValue", value } }]
  });

  state.recordClobber(location);

  deepStrictEqual(state.producersForLocation(location), []);
});

test("JitTrackedState records flag producers and materialized owners through one read API", () => {
  const state = new JitTrackedState(analyzeJitOptimization({ instructions: [] }).context);
  const source: JitFlagSource = {
    id: 3,
    instructionIndex: 0,
    opIndex: 2,
    producer: "add32",
    writtenMask: IR_ALU_FLAG_MASK,
    undefMask: 0,
    inputs: {},
    readRegs: ["eax"]
  };

  state.recordFlagSource(source);
  const sourceOwners = state.cloneFlagOwners();

  deepStrictEqual(state.recordRead({
    location: { kind: "flags", mask: IR_ALU_FLAG_MASKS.CF },
    reason: "condition",
    instructionIndex: 0,
    opIndex: 3,
    cc: "B"
  }), {
    location: { kind: "flags", mask: IR_ALU_FLAG_MASKS.CF },
    reason: "condition",
    instructionIndex: 0,
    opIndex: 3,
    cc: "B",
    producers: [{
      location: { kind: "flags", mask: IR_ALU_FLAG_MASKS.CF },
      producer: { kind: "flagSource", source }
    }]
  });
  deepStrictEqual(state.flagProducerOwnersReadingReg("eax"), [{
    mask: IR_ALU_FLAG_MASK,
    owner: { kind: "producer", source }
  }]);

  state.recordFlagsMaterialized(IR_ALU_FLAG_MASKS.CF);

  deepStrictEqual(state.recordFlagRead({
    requiredMask: IR_ALU_FLAG_MASKS.CF,
    reason: "condition"
  }, sourceOwners).producers, [{
    location: { kind: "flags", mask: IR_ALU_FLAG_MASKS.CF },
    producer: { kind: "flagSource", source }
  }]);
  deepStrictEqual(state.recordRead({
    location: { kind: "flags", mask: IR_ALU_FLAG_MASKS.CF },
    reason: "materialize"
  }).producers, [{
    location: { kind: "flags", mask: IR_ALU_FLAG_MASKS.CF },
    producer: { kind: "materializedFlags" }
  }]);
});

test("JitTrackedState materializes register locations and dependencies", () => {
  const state = new JitTrackedState(analyzeJitOptimization({ instructions: [] }).context);
  const rewrite = createJitPreludeRewrite();

  state.recordRegisterValue("eax", { kind: "reg", reg: "ecx" });
  state.recordRegisterValue("edx", { kind: "i32.add", a: { kind: "reg", reg: "eax" }, b: { kind: "const32", value: 1 } });

  strictEqual(state.materializeRequiredLocations(rewrite, {
    kind: "registerDependencies",
    reason: "clobber",
    reg: "eax"
  }), 1);
  deepStrictEqual(rewrite.ops.map((op) => op.op), ["get32", "i32.add", "set32"]);
  deepStrictEqual(state.producersForLocation({ kind: "register", reg: "edx" }), []);

  strictEqual(state.materializeRequiredLocations(rewrite, {
    kind: "locations",
    reason: "read",
    locations: [{ kind: "register", reg: "eax" }]
  }), 1);
  deepStrictEqual(rewrite.ops.slice(-2), [
    { op: "get32", dst: { kind: "var", id: 2 }, source: { kind: "reg", reg: "ecx" } },
    { op: "set32", target: { kind: "reg", reg: "eax" }, value: { kind: "var", id: 2 } }
  ]);
});

test("JitTrackedState materializes registers for indexed exits", () => {
  const block = {
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: { kind: "var", id: 0 }, source: { kind: "mem", address: { kind: "const32", value: 0x1000 } } },
        { op: "next" }
      ])
    ]
  };
  const state = new JitTrackedState(analyzeJitOptimization(block).context);
  const rewrite = createJitPreludeRewrite();

  state.recordRegisterValue("eax", { kind: "const32", value: 1 });

  strictEqual(state.materializeRegistersForPreInstructionExits(rewrite, 0), 1);
  deepStrictEqual(rewrite.ops, [
    { op: "set32", target: { kind: "reg", reg: "eax" }, value: { kind: "const32", value: 1 } }
  ]);
});
