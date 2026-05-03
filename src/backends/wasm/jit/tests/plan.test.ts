import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { ok, decodeBytes } from "#x86/isa/decoder/tests/helpers.js";
import { IR_ALU_FLAG_MASK, IR_ALU_FLAG_MASKS } from "#x86/ir/passes/flag-analysis.js";
import { ExitReason, type ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import { buildJitIrBlock } from "#backends/wasm/jit/block.js";
import { planJitIrBlock, type JitPlannedExit } from "#backends/wasm/jit/planning/plan.js";

const startAddress = 0x1000;

test("planJitIrBlock records post-instruction fallthrough exits", () => {
  const instruction = ok(decodeBytes([0xb8, 0x01, 0x00, 0x00, 0x00], startAddress));
  const plan = planJitIrBlock(buildJitIrBlock([instruction]));
  const exit = onlyExit(plan.exits, ExitReason.FALLTHROUGH);

  strictEqual(plan.maxExitGeneration, 1);
  strictEqual(exit.snapshot.kind, "postInstruction");
  strictEqual(exit.snapshot.eip, instruction.nextEip);
  strictEqual(exit.snapshot.instructionCountDelta, 1);
  deepStrictEqual(exit.snapshot.committedRegs, ["eax"]);
  deepStrictEqual(exit.snapshot.speculativeRegs, []);
  strictEqual(exit.requiredFlagCommitMask, 0);
});

test("planJitIrBlock keeps memory faults at pre-instruction snapshots", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const load = ok(decodeBytes([0x8b, 0x05, 0x00, 0x00, 0x01, 0x00], add.nextEip));
  const plan = planJitIrBlock(buildJitIrBlock([add, load]));
  const exit = onlyExit(plan.exits, ExitReason.MEMORY_READ_FAULT);

  strictEqual(exit.instructionIndex, 1);
  strictEqual(exit.snapshot.kind, "preInstruction");
  strictEqual(exit.snapshot.eip, load.address);
  strictEqual(exit.snapshot.instructionCountDelta, 1);
  deepStrictEqual(exit.snapshot.committedRegs, ["eax"]);
  deepStrictEqual(exit.snapshot.speculativeRegs, []);
  strictEqual(exit.snapshot.speculativeFlags.mask, IR_ALU_FLAG_MASK);
  strictEqual(exit.requiredFlagCommitMask, IR_ALU_FLAG_MASK);
});

test("planJitIrBlock excludes current-instruction speculative writes from memory fault snapshots", () => {
  const instruction = ok(decodeBytes([0x01, 0x18], startAddress));
  const plan = planJitIrBlock(buildJitIrBlock([instruction]));
  const writeFault = onlyExit(plan.exits, ExitReason.MEMORY_WRITE_FAULT);

  strictEqual(writeFault.snapshot.kind, "preInstruction");
  strictEqual(writeFault.snapshot.eip, instruction.address);
  strictEqual(writeFault.snapshot.instructionCountDelta, 0);
  deepStrictEqual(writeFault.snapshot.committedRegs, []);
  deepStrictEqual(writeFault.snapshot.speculativeRegs, []);
  strictEqual(writeFault.snapshot.speculativeFlags.mask, 0);
  strictEqual(writeFault.requiredFlagCommitMask, 0);
});

test("planJitIrBlock records flag materialization pressure before conditions and exits", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const jz = ok(decodeBytes([0x74, 0x05], add.nextEip));
  const plan = planJitIrBlock(buildJitIrBlock([add, jz]));
  const conditionMaterialization = plan.flagMaterializations.find((entry) => entry.reason === "condition");
  const branchExits = plan.exits.filter((entry) =>
    entry.exitReason === ExitReason.BRANCH_TAKEN || entry.exitReason === ExitReason.BRANCH_NOT_TAKEN
  );

  deepStrictEqual(conditionMaterialization, {
    instructionIndex: 1,
    opIndex: 0,
    reason: "condition",
    requiredMask: IR_ALU_FLAG_MASKS.ZF,
    pendingMask: IR_ALU_FLAG_MASKS.ZF
  });
  strictEqual(branchExits.length, 2);

  for (const exit of branchExits) {
    strictEqual(exit.snapshot.kind, "postInstruction");
    strictEqual(exit.requiredFlagCommitMask, IR_ALU_FLAG_MASK);
  }
});

function onlyExit(exits: readonly JitPlannedExit[], reason: ExitReasonValue): JitPlannedExit {
  const matches = exits.filter((entry) => entry.exitReason === reason);

  strictEqual(matches.length, 1);
  return matches[0]!;
}
