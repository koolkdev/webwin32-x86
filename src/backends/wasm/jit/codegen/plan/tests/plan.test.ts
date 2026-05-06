import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { ok, decodeBytes } from "#x86/isa/decoder/tests/helpers.js";
import { IR_ALU_FLAG_MASK, IR_ALU_FLAG_MASKS } from "#x86/ir/model/flag-effects.js";
import { buildIrExpressionBlock } from "#backends/wasm/codegen/expressions.js";
import { ExitReason } from "#backends/wasm/exit.js";
import { buildJitIrBlock } from "#backends/wasm/jit/block.js";
import { buildJitCodegenIr } from "#backends/wasm/jit/codegen/plan/block.js";
import { buildJitCodegenEmissionPlan } from "#backends/wasm/jit/codegen/plan/emission.js";
import { planJitMaterializedValueUses } from "#backends/wasm/jit/codegen/plan/materialized-values.js";
import { planJitCodegen } from "#backends/wasm/jit/codegen/plan/plan.js";
import type { JitCodegenPlan, JitStateSnapshot } from "#backends/wasm/jit/codegen/plan/types.js";
import type { JitIrBlock } from "#backends/wasm/jit/ir/types.js";
import { optimizeJitIrBlock } from "#backends/wasm/jit/optimization/optimize.js";
import { onlyExit, startAddress } from "../../../optimization/tests/helpers.js";

test("planJitCodegen records post-instruction fallthrough exits", () => {
  const instruction = ok(decodeBytes([0xb8, 0x01, 0x00, 0x00, 0x00], startAddress));
  const codegenPlan = planJitCodegen(optimizeJitIrBlock(buildJitIrBlock([instruction])));
  const exit = onlyExit(codegenPlan.exitPoints, ExitReason.FALLTHROUGH);
  const instructionState = codegenPlan.instructionStates[0]!;

  strictEqual(codegenPlan.maxExitStateIndex, 1);
  deepStrictEqual(codegenPlan.exitStates, [
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

test("planJitCodegen keeps memory faults at pre-instruction snapshots", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const load = ok(decodeBytes([0x8b, 0x05, 0x00, 0x00, 0x01, 0x00], add.nextEip));
  const codegenPlan = planJitCodegen(optimizeJitIrBlock(buildJitIrBlock([add, load])));
  const exit = onlyExit(codegenPlan.exitPoints, ExitReason.MEMORY_READ_FAULT);

  deepStrictEqual(codegenPlan.instructionStates.map((entry) => entry.preInstructionExitPointCount), [0, 1]);
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

test("planJitCodegen excludes current-instruction speculative writes from memory fault snapshots", () => {
  const instruction = ok(decodeBytes([0x01, 0x18], startAddress));
  const codegenPlan = planJitCodegen(optimizeJitIrBlock(buildJitIrBlock([instruction])));
  const writeFault = onlyExit(codegenPlan.exitPoints, ExitReason.MEMORY_WRITE_FAULT);

  strictEqual(codegenPlan.instructionStates[0]!.preInstructionExitPointCount, 2);
  strictEqual(writeFault.snapshot.kind, "preInstruction");
  strictEqual(writeFault.snapshot.eip, instruction.address);
  strictEqual(writeFault.snapshot.instructionCountDelta, 0);
  strictEqual(writeFault.exitStateIndex, 0);
  deepStrictEqual(writeFault.snapshot.committedRegs, []);
  deepStrictEqual(writeFault.snapshot.speculativeRegs, []);
  strictEqual(writeFault.snapshot.speculativeFlags.mask, 0);
  strictEqual(writeFault.requiredFlagCommitMask, 0);
});

test("planJitCodegen records exit states only for actual exit points", () => {
  const movEax = ok(decodeBytes([0xb8, 0x01, 0x00, 0x00, 0x00], startAddress));
  const movEbx = ok(decodeBytes([0xbb, 0x02, 0x00, 0x00, 0x00], movEax.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], movEbx.nextEip));
  const codegenPlan = planJitCodegen(optimizeJitIrBlock(buildJitIrBlock([movEax, movEbx, trap])));

  strictEqual(codegenPlan.maxExitStateIndex, 1);
  deepStrictEqual(codegenPlan.exitStates, [
    { regs: [] },
    { regs: ["eax", "ebx"] }
  ]);
  deepStrictEqual(codegenPlan.instructionStates.map((entry) => entry.preInstructionExitPointCount), [0, 0, 0]);
  deepStrictEqual(codegenPlan.instructionStates.map((entry) => entry.exitPointCount), [0, 0, 1]);
});

test("planJitCodegen records flag materialization requirements before conditions and exits", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const jb = ok(decodeBytes([0x72, 0x05], add.nextEip));
  const codegenPlan = planJitCodegen(optimizeJitIrBlock(buildJitIrBlock([add, jb])));
  const conditionMaterialization = codegenPlan.flagMaterializationRequirements.find(
    (entry) => entry.reason === "condition"
  );
  const branchExits = codegenPlan.exitPoints.filter((entry) =>
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

test("buildJitCodegenEmissionPlan prepares expression blocks and value-cache specs", () => {
  const block: JitIrBlock = {
    instructions: [{
      instructionId: "cache-plan",
      eip: startAddress,
      nextEip: startAddress + 1,
      nextMode: "exit",
      operands: [],
      ir: [
        { op: "get", dst: { kind: "var", id: 0 }, source: { kind: "reg", reg: "eax" }, accessWidth: 32 },
        {
          op: "value.binary",
          type: "i32",
          operator: "add",
          dst: { kind: "var", id: 1 },
          a: { kind: "var", id: 0 },
          b: { kind: "const", type: "i32", value: 1 }
        },
        { op: "get", dst: { kind: "var", id: 2 }, source: { kind: "reg", reg: "eax" }, accessWidth: 32 },
        {
          op: "value.binary",
          type: "i32",
          operator: "add",
          dst: { kind: "var", id: 3 },
          a: { kind: "var", id: 2 },
          b: { kind: "const", type: "i32", value: 1 }
        },
        {
          op: "conditionalJump",
          condition: { kind: "const", type: "i32", value: 0 },
          taken: { kind: "var", id: 1 },
          notTaken: { kind: "var", id: 3 }
        }
      ]
    }]
  };
  const codegenPlan = planJitCodegen(block);
  const emissionPlan = buildJitCodegenEmissionPlan(buildJitCodegenIr(codegenPlan), codegenPlan);
  const [instruction] = emissionPlan.instructions;

  strictEqual(instruction?.instructionId, "cache-plan");
  strictEqual(emissionPlan.exitPoints, codegenPlan.exitPoints);
  strictEqual(emissionPlan.exitStates, codegenPlan.exitStates);
  strictEqual(instruction?.expressionBlock.some((op) => op.op === "conditionalJump"), true);
  strictEqual((instruction?.valueCachePlan?.selectedUseCounts.length ?? 0) > 0, true);
  strictEqual((instruction?.valueCachePlan?.selectedValuesByEpoch.length ?? 0) > 0, true);
});

test("buildJitCodegenEmissionPlan does not count overwritten materializations as exit-store uses", () => {
  const block: JitIrBlock = {
    instructions: [
      {
        instructionId: "materialize-before-overwrite",
        eip: startAddress,
        nextEip: startAddress + 1,
        nextMode: "continue",
        operands: [],
        ir: [
          { op: "get", dst: { kind: "var", id: 0 }, source: { kind: "reg", reg: "eax" }, accessWidth: 32 },
          {
            op: "value.binary",
            type: "i32",
            operator: "add",
            dst: { kind: "var", id: 1 },
            a: { kind: "var", id: 0 },
            b: { kind: "const", type: "i32", value: 1 }
          },
          {
            op: "set",
            role: "registerMaterialization",
            target: { kind: "reg", reg: "eax" },
            value: { kind: "var", id: 1 }
          },
          { op: "next" }
        ]
      },
      {
        instructionId: "overwrite-before-exit",
        eip: startAddress + 1,
        nextEip: startAddress + 2,
        nextMode: "exit",
        operands: [],
        ir: [
          {
            op: "set",
            target: { kind: "reg", reg: "eax" },
            value: { kind: "const", type: "i32", value: 0 },
            accessWidth: 32
          },
          { op: "hostTrap", vector: { kind: "const", type: "i32", value: 0x2e } }
        ]
      }
    ]
  };
  const plan: JitCodegenPlan = {
    block,
    instructionStates: [
      {
        instructionId: "materialize-before-overwrite",
        eip: startAddress,
        nextEip: startAddress + 1,
        nextMode: "continue",
        preInstructionState: snapshot("preInstruction", startAddress, 0),
        postInstructionState: snapshot("postInstruction", startAddress + 1, 1, ["eax"]),
        preInstructionExitPointCount: 0,
        exitPointCount: 0
      },
      {
        instructionId: "overwrite-before-exit",
        eip: startAddress + 1,
        nextEip: startAddress + 2,
        nextMode: "exit",
        preInstructionState: snapshot("preInstruction", startAddress + 1, 1, ["eax"]),
        postInstructionState: snapshot("postInstruction", startAddress + 2, 2, ["eax"]),
        preInstructionExitPointCount: 0,
        exitPointCount: 1
      }
    ],
    exitPoints: [{
      instructionIndex: 1,
      opIndex: 1,
      exitReason: ExitReason.HOST_TRAP,
      snapshot: snapshot("postInstruction", startAddress + 2, 2, ["eax"]),
      exitStateIndex: 1,
      requiredFlagCommitMask: 0
    }],
    flagMaterializationRequirements: [],
    exitStates: [{ regs: [] }, { regs: ["eax"] }],
    maxExitStateIndex: 1
  };
  const emissionPlan = buildJitCodegenEmissionPlan(block, plan);

  strictEqual(emissionPlan.valueCachePlan, undefined);
});

test("buildJitCodegenEmissionPlan does not count same-instruction later materializations for earlier exits", () => {
  const block: JitIrBlock = {
    instructions: [{
      instructionId: "fault-before-materialization",
      eip: startAddress,
      nextEip: startAddress + 1,
      nextMode: "continue",
      operands: [],
      ir: [
        {
          op: "get",
          dst: { kind: "var", id: 0 },
          source: { kind: "mem", address: { kind: "const", type: "i32", value: 0x10000 } },
          accessWidth: 32
        },
        { op: "get", dst: { kind: "var", id: 1 }, source: { kind: "reg", reg: "eax" }, accessWidth: 32 },
        {
          op: "value.binary",
          type: "i32",
          operator: "add",
          dst: { kind: "var", id: 2 },
          a: { kind: "var", id: 1 },
          b: { kind: "const", type: "i32", value: 1 }
        },
        {
          op: "set",
          role: "registerMaterialization",
          target: { kind: "reg", reg: "eax" },
          value: { kind: "var", id: 2 },
          accessWidth: 32
        },
        { op: "next" }
      ]
    }]
  };
  const plan: JitCodegenPlan = {
    block,
    instructionStates: [{
      instructionId: "fault-before-materialization",
      eip: startAddress,
      nextEip: startAddress + 1,
      nextMode: "continue",
      preInstructionState: snapshot("preInstruction", startAddress, 0, ["eax"]),
      postInstructionState: snapshot("postInstruction", startAddress + 1, 1, ["eax"]),
      preInstructionExitPointCount: 1,
      exitPointCount: 1
    }],
    exitPoints: [{
      instructionIndex: 0,
      opIndex: 0,
      exitReason: ExitReason.MEMORY_READ_FAULT,
      snapshot: snapshot("preInstruction", startAddress, 0, ["eax"]),
      exitStateIndex: 1,
      requiredFlagCommitMask: 0
    }],
    flagMaterializationRequirements: [],
    exitStates: [{ regs: [] }, { regs: ["eax"] }],
    maxExitStateIndex: 1
  };
  const emissionPlan = buildJitCodegenEmissionPlan(block, plan);

  strictEqual(emissionPlan.valueCachePlan, undefined);
});

test("planJitMaterializedValueUses maps source materializations through inserted flag boundaries", () => {
  const block: JitIrBlock = {
    instructions: [{
      instructionId: "boundary-before-materialization",
      eip: startAddress,
      nextEip: startAddress + 1,
      nextMode: "exit",
      operands: [],
      ir: [
        {
          op: "get",
          dst: { kind: "var", id: 0 },
          source: { kind: "mem", address: { kind: "const", type: "i32", value: 0x10000 } },
          accessWidth: 32
        },
        { op: "get", dst: { kind: "var", id: 1 }, source: { kind: "reg", reg: "eax" }, accessWidth: 32 },
        {
          op: "value.binary",
          type: "i32",
          operator: "add",
          dst: { kind: "var", id: 2 },
          a: { kind: "var", id: 1 },
          b: { kind: "const", type: "i32", value: 1 }
        },
        {
          op: "set",
          role: "registerMaterialization",
          target: { kind: "reg", reg: "eax" },
          value: { kind: "var", id: 2 },
          accessWidth: 32
        },
        { op: "hostTrap", vector: { kind: "const", type: "i32", value: 0x2e } }
      ]
    }]
  };
  const plan: JitCodegenPlan = {
    block,
    instructionStates: [{
      instructionId: "boundary-before-materialization",
      eip: startAddress,
      nextEip: startAddress + 1,
      nextMode: "exit",
      preInstructionState: snapshot("preInstruction", startAddress, 0, [], IR_ALU_FLAG_MASK),
      postInstructionState: snapshot("postInstruction", startAddress + 1, 1, ["eax"]),
      preInstructionExitPointCount: 1,
      exitPointCount: 2
    }],
    exitPoints: [
      {
        instructionIndex: 0,
        opIndex: 0,
        exitReason: ExitReason.MEMORY_READ_FAULT,
        snapshot: snapshot("preInstruction", startAddress, 0, [], IR_ALU_FLAG_MASK),
        exitStateIndex: 0,
        requiredFlagCommitMask: IR_ALU_FLAG_MASK
      },
      {
        instructionIndex: 0,
        opIndex: 4,
        exitReason: ExitReason.HOST_TRAP,
        snapshot: snapshot("postInstruction", startAddress + 1, 1, ["eax"]),
        exitStateIndex: 1,
        requiredFlagCommitMask: 0
      }
    ],
    flagMaterializationRequirements: [],
    exitStates: [{ regs: [] }, { regs: ["eax"] }],
    maxExitStateIndex: 1
  };
  const codegenIr = buildJitCodegenIr(plan);
  const [instruction] = codegenIr.instructions;

  if (instruction === undefined) {
    throw new Error("missing codegen instruction");
  }

  const expressionBlock = buildIrExpressionBlock(instruction.ir);
  const materializedValueUsePlan = planJitMaterializedValueUses([{ expressionBlock }], plan);
  const boundaryIndex = expressionBlock.findIndex((op) => op.op === "flags.boundary");
  const setIndex = expressionBlock.findIndex((op) => op.op === "set" && op.role === "registerMaterialization");

  strictEqual(boundaryIndex !== -1 && setIndex !== -1 && boundaryIndex < setIndex, true);
  deepStrictEqual([...(materializedValueUsePlan.expressionUseIndexesByInstruction[0] ?? new Set())], [setIndex]);
});

function snapshot(
  kind: JitStateSnapshot["kind"],
  eip: number,
  instructionCountDelta: number,
  committedRegs: JitStateSnapshot["committedRegs"] = [],
  speculativeFlagMask = 0
): JitStateSnapshot {
  return {
    kind,
    eip,
    instructionCountDelta,
    committedRegs,
    speculativeRegs: [],
    committedFlags: { mask: 0 },
    speculativeFlags: { mask: speculativeFlagMask }
  };
}
