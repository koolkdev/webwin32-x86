import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import type { Reg32 } from "#x86/isa/types.js";
import { ok, decodeBytes } from "#x86/isa/decoder/tests/helpers.js";
import { createIrFlagSetOp } from "#x86/ir/model/flags.js";
import type { IrBlock, VarRef } from "#x86/ir/model/types.js";
import { IR_ALU_FLAG_MASK, IR_ALU_FLAG_MASKS } from "#x86/ir/passes/flag-analysis.js";
import { ExitReason, type ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import { buildJitIrBlock } from "#backends/wasm/jit/block.js";
import { optimizeJitIrBlock } from "#backends/wasm/jit/optimization/optimize.js";
import {
  jitIrOptimizationPassOrder,
  runJitIrOptimizationPipeline
} from "#backends/wasm/jit/optimization/pipeline.js";
import type { JitExitPoint } from "#backends/wasm/jit/optimization/types.js";
import {
  analyzeJitVirtualFlags,
  materializeJitVirtualFlags,
  type JitVirtualFlagOwnerMask
} from "#backends/wasm/jit/optimization/virtual-flags.js";
import { foldJitVirtualRegisters } from "#backends/wasm/jit/optimization/virtual-registers.js";
import type { JitIrBlock, JitIrBlockInstruction } from "#backends/wasm/jit/types.js";

const startAddress = 0x1000;

test("optimizeJitIrBlock records post-instruction fallthrough exits", () => {
  const instruction = ok(decodeBytes([0xb8, 0x01, 0x00, 0x00, 0x00], startAddress));
  const optimization = optimizeJitIrBlock(buildJitIrBlock([instruction]));
  const exit = onlyExit(optimization.exitPoints, ExitReason.FALLTHROUGH);
  const instructionState = optimization.instructionStates[0]!;

  strictEqual(optimization.maxExitStateIndex, 1);
  deepStrictEqual(optimization.exitStates, [
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

test("optimizeJitIrBlock keeps memory faults at pre-instruction snapshots", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const load = ok(decodeBytes([0x8b, 0x05, 0x00, 0x00, 0x01, 0x00], add.nextEip));
  const optimization = optimizeJitIrBlock(buildJitIrBlock([add, load]));
  const exit = onlyExit(optimization.exitPoints, ExitReason.MEMORY_READ_FAULT);

  deepStrictEqual(optimization.instructionStates.map((entry) => entry.preInstructionExitPointCount), [0, 1]);
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

test("optimizeJitIrBlock excludes current-instruction speculative writes from memory fault snapshots", () => {
  const instruction = ok(decodeBytes([0x01, 0x18], startAddress));
  const optimization = optimizeJitIrBlock(buildJitIrBlock([instruction]));
  const writeFault = onlyExit(optimization.exitPoints, ExitReason.MEMORY_WRITE_FAULT);

  strictEqual(optimization.instructionStates[0]!.preInstructionExitPointCount, 2);
  strictEqual(writeFault.snapshot.kind, "preInstruction");
  strictEqual(writeFault.snapshot.eip, instruction.address);
  strictEqual(writeFault.snapshot.instructionCountDelta, 0);
  strictEqual(writeFault.exitStateIndex, 0);
  deepStrictEqual(writeFault.snapshot.committedRegs, []);
  deepStrictEqual(writeFault.snapshot.speculativeRegs, []);
  strictEqual(writeFault.snapshot.speculativeFlags.mask, 0);
  strictEqual(writeFault.requiredFlagCommitMask, 0);
});

test("optimizeJitIrBlock records exit states only for actual exit points", () => {
  const movEax = ok(decodeBytes([0xb8, 0x01, 0x00, 0x00, 0x00], startAddress));
  const movEbx = ok(decodeBytes([0xbb, 0x02, 0x00, 0x00, 0x00], movEax.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], movEbx.nextEip));
  const optimization = optimizeJitIrBlock(buildJitIrBlock([movEax, movEbx, trap]));

  strictEqual(optimization.maxExitStateIndex, 1);
  deepStrictEqual(optimization.exitStates, [
    { regs: [] },
    { regs: ["eax", "ebx"] }
  ]);
  deepStrictEqual(optimization.instructionStates.map((entry) => entry.preInstructionExitPointCount), [0, 0, 0]);
  deepStrictEqual(optimization.instructionStates.map((entry) => entry.exitPointCount), [0, 0, 1]);
});

test("optimizeJitIrBlock records flag materialization requirements before conditions and exits", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const jz = ok(decodeBytes([0x74, 0x05], add.nextEip));
  const optimization = optimizeJitIrBlock(buildJitIrBlock([add, jz]));
  const conditionMaterialization = optimization.flagMaterializationRequirements.find(
    (entry) => entry.reason === "condition"
  );
  const branchExits = optimization.exitPoints.filter((entry) =>
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

test("materializeJitVirtualFlags removes overwritten flag producers across instruction bodies", () => {
  const cmp = ok(decodeBytes([0x39, 0xd8], startAddress));
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], cmp.nextEip));
  const materialized = materializeJitVirtualFlags(buildJitIrBlock([cmp, add]));
  const flagSets = materialized.block.instructions.flatMap((instruction) =>
    instruction.ir.filter((op) => op.op === "flags.set")
  );

  strictEqual(materialized.flags.removedSetCount, 1);
  strictEqual(materialized.flags.retainedSetCount, 1);
  deepStrictEqual(flagSets.map((op) => op.op === "flags.set" ? op.producer : undefined), ["add32"]);
});

test("materializeJitVirtualFlags keeps partial flag producers needed by later conditions", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const inc = ok(decodeBytes([0x40], add.nextEip));
  const jc = ok(decodeBytes([0x72, 0x05], inc.nextEip));
  const materialized = materializeJitVirtualFlags(buildJitIrBlock([add, inc, jc]));
  const flagSets = materialized.block.instructions.flatMap((instruction) =>
    instruction.ir.filter((op) => op.op === "flags.set")
  );

  strictEqual(materialized.flags.removedSetCount, 0);
  strictEqual(materialized.flags.retainedSetCount, 2);
  deepStrictEqual(flagSets.map((op) => op.op === "flags.set" ? op.producer : undefined), ["add32", "inc32"]);
});

test("materializeJitVirtualFlags keeps flag producers needed by memory fault exits", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const load = ok(decodeBytes([0x8b, 0x15, 0x00, 0x00, 0x01, 0x00], add.nextEip));
  const materialized = materializeJitVirtualFlags(buildJitIrBlock([add, load]));
  const flagSets = materialized.block.instructions.flatMap((instruction) =>
    instruction.ir.filter((op) => op.op === "flags.set")
  );

  strictEqual(materialized.flags.removedSetCount, 0);
  strictEqual(materialized.flags.retainedSetCount, 1);
  deepStrictEqual(flagSets.map((op) => op.op === "flags.set" ? op.producer : undefined), ["add32"]);
});

test("analyzeJitVirtualFlags keeps partial flag ownership across INC", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const inc = ok(decodeBytes([0x40], add.nextEip));
  const jc = ok(decodeBytes([0x72, 0x05], inc.nextEip));
  const analysis = analyzeJitVirtualFlags(buildJitIrBlock([add, inc, jc]));
  const conditionRead = analysis.reads.find((read) => read.reason === "condition");
  const exitRead = analysis.reads.find((read) => read.reason === "exit");

  deepStrictEqual(analysis.sources.map((source) => source.producer), ["add32", "inc32"]);
  strictEqual(conditionRead?.cc, "B");
  strictEqual(conditionRead?.requiredMask, IR_ALU_FLAG_MASKS.CF);
  deepStrictEqual(flagOwnerSummary(conditionRead?.owners ?? []), [
    { mask: IR_ALU_FLAG_MASKS.CF, kind: "producer", sourceId: 0, producer: "add32" }
  ]);
  deepStrictEqual(flagOwnerSummary(exitRead?.owners ?? []), [
    { mask: IR_ALU_FLAG_MASKS.CF, kind: "producer", sourceId: 0, producer: "add32" },
    { mask: IR_ALU_FLAG_MASK & ~IR_ALU_FLAG_MASKS.CF, kind: "producer", sourceId: 1, producer: "inc32" }
  ]);
  deepStrictEqual(flagOwnerSummary(analysis.finalOwners), [
    { mask: IR_ALU_FLAG_MASKS.CF, kind: "producer", sourceId: 0, producer: "add32" },
    { mask: IR_ALU_FLAG_MASK & ~IR_ALU_FLAG_MASKS.CF, kind: "producer", sourceId: 1, producer: "inc32" }
  ]);
});

test("analyzeJitVirtualFlags records memory-fault reads from instruction entry owners", () => {
  const addMem = ok(decodeBytes([0x01, 0x18], startAddress));
  const analysis = analyzeJitVirtualFlags(buildJitIrBlock([addMem]));
  const memoryFaultReads = analysis.reads.filter((read) => read.reason === "memoryFault");
  const exitRead = analysis.reads.find((read) => read.reason === "exit");

  strictEqual(memoryFaultReads.length, 2);

  for (const read of memoryFaultReads) {
    deepStrictEqual(flagOwnerSummary(read.owners), [
      { mask: IR_ALU_FLAG_MASK, kind: "incoming" }
    ]);
  }

  deepStrictEqual(flagOwnerSummary(exitRead?.owners ?? []), [
    { mask: IR_ALU_FLAG_MASK, kind: "producer", sourceId: 0, producer: "add32" }
  ]);
});

test("analyzeJitVirtualFlags records producer inputs and source clobbers", () => {
  const add = ok(decodeBytes([0x83, 0xc0, 0x01], startAddress));
  const analysis = analyzeJitVirtualFlags(buildJitIrBlock([add]));
  const source = analysis.sources[0]!;
  const clobber = analysis.sourceClobbers[0]!;

  strictEqual(source.producer, "add32");
  strictEqual(source.writtenMask, IR_ALU_FLAG_MASK);
  strictEqual(source.undefMask, 0);
  deepStrictEqual(source.inputs, {
    left: { kind: "value", value: { kind: "reg", reg: "eax" } },
    right: { kind: "value", value: { kind: "const32", value: 1 } },
    result: {
      kind: "value",
      value: {
        kind: "i32.add",
        a: { kind: "reg", reg: "eax" },
        b: { kind: "const32", value: 1 }
      }
    }
  });
  deepStrictEqual(source.readRegs, ["eax"]);
  strictEqual(clobber.instructionIndex, 0);
  strictEqual(clobber.reg, "eax");
  deepStrictEqual(flagOwnerSummary(clobber.owners), [
    { mask: IR_ALU_FLAG_MASK, kind: "producer", sourceId: 0, producer: "add32" }
  ]);
});

test("materializeJitVirtualFlags emits direct non-exit condition reads", () => {
  const materialized = materializeJitVirtualFlags({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "get32", dst: v(1), source: { kind: "reg", reg: "ebx" } },
        { op: "i32.sub", dst: v(2), a: v(0), b: v(1) },
        createIrFlagSetOp("sub32", { left: v(0), right: v(1), result: v(2) }),
        { op: "aluFlags.condition", dst: v(3), cc: "E" },
        { op: "set32", target: { kind: "reg", reg: "ecx" }, value: v(3) },
        { op: "next" }
      ])
    ]
  });
  const ir = materialized.block.instructions[0]!.ir;

  strictEqual(materialized.flags.directConditionCount, 1);
  strictEqual(materialized.flags.removedSetCount, 1);
  strictEqual(materialized.flags.retainedSetCount, 0);
  strictEqual(ir.some((op) => op.op === "flags.set"), false);
  strictEqual(ir.some((op) => op.op === "aluFlags.condition"), false);
  strictEqual(ir.some((op) => op.op === "flagProducer.condition"), true);
});

test("materializeJitVirtualFlags keeps clobbered producer inputs captured", () => {
  const materialized = materializeJitVirtualFlags({
    instructions: [
      syntheticInstruction([
        { op: "get32", dst: v(0), source: { kind: "reg", reg: "eax" } },
        { op: "get32", dst: v(1), source: { kind: "reg", reg: "ebx" } },
        { op: "i32.sub", dst: v(2), a: v(0), b: v(1) },
        createIrFlagSetOp("sub32", { left: v(0), right: v(1), result: v(2) }),
        { op: "next" }
      ], 0),
      syntheticInstruction([
        { op: "const32", dst: v(0), value: 0 },
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(0) },
        { op: "aluFlags.condition", dst: v(1), cc: "E" },
        { op: "set32", target: { kind: "reg", reg: "ecx" }, value: v(1) },
        { op: "next" }
      ], 1)
    ]
  });
  const ir = materialized.block.instructions.flatMap((instruction) => instruction.ir);

  strictEqual(materialized.flags.directConditionCount, 0);
  strictEqual(materialized.flags.removedSetCount, 0);
  strictEqual(materialized.flags.retainedSetCount, 1);
  strictEqual(ir.some((op) => op.op === "flags.set"), true);
  strictEqual(ir.some((op) => op.op === "aluFlags.condition"), true);
  strictEqual(ir.some((op) => op.op === "flagProducer.condition"), false);
});

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

  deepStrictEqual(jitIrOptimizationPassOrder, ["virtual-flags", "virtual-registers"]);
  strictEqual(result.passes.virtualFlags.removedSetCount, 1);
  strictEqual(result.passes.virtualRegisters.removedSetCount, 3);
});

test("foldJitVirtualRegisters keeps transient register calculations virtual until exit", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const xorEax = ok(decodeBytes([0x83, 0xf0, 0x02], movEaxEcx.nextEip));
  const addEbxEax = ok(decodeBytes([0x01, 0xc3], xorEax.nextEip));
  const movEaxZero = ok(decodeBytes([0xb8, 0x00, 0x00, 0x00, 0x00], addEbxEax.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], movEaxZero.nextEip));
  const folded = foldJitVirtualRegisters(buildJitIrBlock([
    movEaxEcx,
    xorEax,
    addEbxEax,
    movEaxZero,
    trap
  ]));

  strictEqual(folded.folding.removedSetCount, 4);
  strictEqual(folded.folding.materializedSetCount, 2);
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["eax", "ebx"]);
});

test("foldJitVirtualRegisters materializes repeated expensive virtual reads", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const xorEax = ok(decodeBytes([0x83, 0xf0, 0x02], movEaxEcx.nextEip));
  const addEbxEax = ok(decodeBytes([0x01, 0xc3], xorEax.nextEip));
  const addEdxEax = ok(decodeBytes([0x01, 0xc2], addEbxEax.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], addEdxEax.nextEip));
  const folded = foldJitVirtualRegisters(buildJitIrBlock([
    movEaxEcx,
    xorEax,
    addEbxEax,
    addEdxEax,
    trap
  ]));

  strictEqual(folded.folding.removedSetCount, 4);
  strictEqual(folded.folding.materializedSetCount, 3);
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["eax", "ebx", "edx"]);
});

test("foldJitVirtualRegisters keeps oversized expressions concrete", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const xor1 = ok(decodeBytes([0x83, 0xf0, 0x01], movEaxEcx.nextEip));
  const xor2 = ok(decodeBytes([0x83, 0xf0, 0x02], xor1.nextEip));
  const xor3 = ok(decodeBytes([0x83, 0xf0, 0x03], xor2.nextEip));
  const xor4 = ok(decodeBytes([0x83, 0xf0, 0x04], xor3.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], xor4.nextEip));
  const folded = foldJitVirtualRegisters(buildJitIrBlock([
    movEaxEcx,
    xor1,
    xor2,
    xor3,
    xor4,
    trap
  ]));

  strictEqual(folded.folding.removedSetCount, 4);
  strictEqual(folded.folding.materializedSetCount, 0);
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["eax"]);
});

test("foldJitVirtualRegisters folds virtual register values into indirect jump targets", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const xorEax = ok(decodeBytes([0x83, 0xf0, 0x02], movEaxEcx.nextEip));
  const jmpEax = ok(decodeBytes([0xff, 0xe0], xorEax.nextEip));
  const folded = foldJitVirtualRegisters(buildJitIrBlock([
    movEaxEcx,
    xorEax,
    jmpEax
  ]));
  const jumpInstruction = folded.block.instructions.at(-1)!;
  const jumpIndex = jumpInstruction.ir.findIndex((op) => op.op === "jump");

  strictEqual(folded.folding.removedSetCount, 2);
  strictEqual(folded.folding.materializedSetCount, 1);
  deepStrictEqual(
    jumpInstruction.ir.slice(0, jumpIndex).map((op) => op.op),
    ["get32", "i32.xor", "set32"]
  );
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["eax"]);
});

test("foldJitVirtualRegisters folds virtual register values into effective addresses", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const leaEbx = ok(decodeBytes([0x8d, 0x58, 0x04], movEaxEcx.nextEip));
  const movEaxZero = ok(decodeBytes([0xb8, 0x00, 0x00, 0x00, 0x00], leaEbx.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], movEaxZero.nextEip));
  const folded = foldJitVirtualRegisters(buildJitIrBlock([
    movEaxEcx,
    leaEbx,
    movEaxZero,
    trap
  ]));

  strictEqual(folded.folding.removedSetCount, 3);
  strictEqual(folded.folding.materializedSetCount, 2);
  strictEqual(folded.block.instructions[1]!.ir.some((op) => op.op === "address32"), false);
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["eax", "ebx"]);
});

test("foldJitVirtualRegisters materializes virtual registers for scaled effective addresses", () => {
  const movEaxEcx = ok(decodeBytes([0x89, 0xc8], startAddress));
  const leaEbx = ok(decodeBytes([0x8d, 0x1c, 0x45, 0x04, 0x00, 0x00, 0x00], movEaxEcx.nextEip));
  const movEaxZero = ok(decodeBytes([0xb8, 0x00, 0x00, 0x00, 0x00], leaEbx.nextEip));
  const trap = ok(decodeBytes([0xcd, 0x2e], movEaxZero.nextEip));
  const folded = foldJitVirtualRegisters(buildJitIrBlock([
    movEaxEcx,
    leaEbx,
    movEaxZero,
    trap
  ]));

  strictEqual(folded.folding.removedSetCount, 2);
  strictEqual(folded.folding.materializedSetCount, 2);
  strictEqual(folded.block.instructions[1]!.ir.some((op) => op.op === "address32"), true);
  deepStrictEqual(set32TargetRegs(folded.block.instructions), ["eax", "ebx", "eax"]);
});

function onlyExit(exits: readonly JitExitPoint[], reason: ExitReasonValue): JitExitPoint {
  const matches = exits.filter((entry) => entry.exitReason === reason);

  strictEqual(matches.length, 1);
  return matches[0]!;
}

function syntheticInstruction(ir: IrBlock, index = 0): JitIrBlock["instructions"][number] {
  return {
    instructionId: `synthetic.${index}`,
    eip: startAddress + index,
    nextEip: startAddress + index + 1,
    nextMode: "continue",
    operands: [],
    ir
  };
}

function set32TargetRegs(instructions: readonly JitIrBlockInstruction[]): readonly Reg32[] {
  return instructions.flatMap((instruction) =>
    instruction.ir.flatMap((op) => {
      if (op.op !== "set32") {
        return [];
      }

      switch (op.target.kind) {
        case "reg":
          return [op.target.reg];
        case "operand": {
          const binding = instruction.operands[op.target.index];

          return binding?.kind === "static.reg32" ? [binding.reg] : [];
        }
        case "mem":
          return [];
      }
    })
  );
}

function flagOwnerSummary(owners: readonly JitVirtualFlagOwnerMask[]): readonly object[] {
  return owners.map(({ mask, owner }) => {
    switch (owner.kind) {
      case "producer":
        return { mask, kind: owner.kind, sourceId: owner.source.id, producer: owner.source.producer };
      case "incoming":
      case "materialized":
        return { mask, kind: owner.kind };
    }
  });
}

function v(id: number): VarRef {
  return { kind: "var", id };
}
