import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { ok, decodeBytes } from "#x86/isa/decoder/tests/helpers.js";
import { IR_ALU_FLAG_MASK, IR_ALU_FLAG_MASKS } from "#x86/ir/model/flag-effects.js";
import { ExitReason } from "#backends/wasm/exit.js";
import { buildJitIrBlock } from "#backends/wasm/jit/block.js";
import { planJitLowering } from "#backends/wasm/jit/lowering-plan/lowering-plan.js";
import { optimizeJitIrBlock } from "#backends/wasm/jit/optimization/optimize.js";
import { onlyExit, startAddress } from "./helpers.js";

test("planJitLowering records post-instruction fallthrough exits", () => {
  const instruction = ok(decodeBytes([0xb8, 0x01, 0x00, 0x00, 0x00], startAddress));
  const loweringPlan = planJitLowering(optimizeJitIrBlock(buildJitIrBlock([instruction])));
  const exit = onlyExit(loweringPlan.exitPoints, ExitReason.FALLTHROUGH);
  const instructionState = loweringPlan.instructionStates[0]!;

  strictEqual(loweringPlan.maxExitStateIndex, 1);
  deepStrictEqual(loweringPlan.exitStates, [
    { regs: [] },
    { regs: ["eax"] }
  ]);
  strictEqual(instructionState.preInstructionExitPointCount, 0);
  strictEqual(instructionState.exitPointCount, 1);
  strictEqual(exit.snapshot.kind, "postInstruction");
  strictEqual(exit.snapshot.eip, instruction.nextEip);
  strictEqual(exit.snapshot.instructionCountDelta, 1);
  strictEqual(exit.exitStateIndex, 1);
  deepStrictEqual(exit.snapshot.committedRegs, ["eax"]);
  deepStrictEqual(exit.snapshot.speculativeRegs, []);
  strictEqual(exit.requiredFlagCommitMask, 0);
});

test("planJitLowering keeps memory faults at pre-instruction snapshots", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const load = ok(decodeBytes([0x8b, 0x05, 0x00, 0x00, 0x01, 0x00], add.nextEip));
  const loweringPlan = planJitLowering(optimizeJitIrBlock(buildJitIrBlock([add, load])));
  const exit = onlyExit(loweringPlan.exitPoints, ExitReason.MEMORY_READ_FAULT);

  deepStrictEqual(loweringPlan.instructionStates.map((entry) => entry.preInstructionExitPointCount), [0, 1]);
  strictEqual(exit.instructionIndex, 1);
  strictEqual(exit.snapshot.kind, "preInstruction");
  strictEqual(exit.snapshot.eip, load.address);
  strictEqual(exit.snapshot.instructionCountDelta, 1);
  strictEqual(exit.exitStateIndex, 1);
  deepStrictEqual(exit.snapshot.committedRegs, ["eax"]);
  deepStrictEqual(exit.snapshot.speculativeRegs, []);
  strictEqual(exit.snapshot.speculativeFlags.mask, IR_ALU_FLAG_MASK);
  strictEqual(exit.requiredFlagCommitMask, IR_ALU_FLAG_MASK);
});

test("planJitLowering excludes current-instruction speculative writes from memory fault snapshots", () => {
  const instruction = ok(decodeBytes([0x01, 0x18], startAddress));
  const loweringPlan = planJitLowering(optimizeJitIrBlock(buildJitIrBlock([instruction])));
  const writeFault = onlyExit(loweringPlan.exitPoints, ExitReason.MEMORY_WRITE_FAULT);

  strictEqual(loweringPlan.instructionStates[0]!.preInstructionExitPointCount, 2);
  strictEqual(writeFault.snapshot.kind, "preInstruction");
  strictEqual(writeFault.snapshot.eip, instruction.address);
  strictEqual(writeFault.snapshot.instructionCountDelta, 0);
  strictEqual(writeFault.exitStateIndex, 0);
  deepStrictEqual(writeFault.snapshot.committedRegs, []);
  deepStrictEqual(writeFault.snapshot.speculativeRegs, []);
  strictEqual(writeFault.snapshot.speculativeFlags.mask, 0);
  strictEqual(writeFault.requiredFlagCommitMask, 0);
});

test("planJitLowering records exit states only for actual exit points", () => {
  const movEax = ok(decodeBytes([0xb8, 0x01, 0x00, 0x00, 0x00], startAddress));
  const movEbx = ok(decodeBytes([0xbb, 0x02, 0x00, 0x00, 0x00], movEax.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], movEbx.nextEip));
  const loweringPlan = planJitLowering(optimizeJitIrBlock(buildJitIrBlock([movEax, movEbx, trap])));

  strictEqual(loweringPlan.maxExitStateIndex, 1);
  deepStrictEqual(loweringPlan.exitStates, [
    { regs: [] },
    { regs: ["eax", "ebx"] }
  ]);
  deepStrictEqual(loweringPlan.instructionStates.map((entry) => entry.preInstructionExitPointCount), [0, 0, 0]);
  deepStrictEqual(loweringPlan.instructionStates.map((entry) => entry.exitPointCount), [0, 0, 1]);
});

test("planJitLowering records flag materialization requirements before conditions and exits", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const jb = ok(decodeBytes([0x72, 0x05], add.nextEip));
  const loweringPlan = planJitLowering(optimizeJitIrBlock(buildJitIrBlock([add, jb])));
  const conditionMaterialization = loweringPlan.flagMaterializationRequirements.find(
    (entry) => entry.reason === "condition"
  );
  const branchExits = loweringPlan.exitPoints.filter((entry) =>
    entry.exitReason === ExitReason.BRANCH_TAKEN || entry.exitReason === ExitReason.BRANCH_NOT_TAKEN
  );

  deepStrictEqual(conditionMaterialization, {
    instructionIndex: 1,
    opIndex: 0,
    reason: "condition",
    requiredMask: IR_ALU_FLAG_MASKS.CF,
    pendingMask: IR_ALU_FLAG_MASKS.CF
  });
  strictEqual(branchExits.length, 2);

  for (const exit of branchExits) {
    strictEqual(exit.snapshot.kind, "postInstruction");
    strictEqual(exit.requiredFlagCommitMask, IR_ALU_FLAG_MASK);
  }
});
