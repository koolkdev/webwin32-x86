import type { JitIrBlock, JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import type { JitOptimizationPass } from "#backends/wasm/jit/optimization/pass.js";
import { jitIrOpIsTerminator } from "#backends/wasm/jit/ir-semantics.js";
import {
  assignJitValue,
  materializeJitRegisterValue,
  createJitInstructionRewrite,
  rewriteJitIrInstructionInto,
  type JitInstructionRewrite
} from "#backends/wasm/jit/ir/rewrite.js";
import {
  jitStorageReg,
  type JitValue
} from "#backends/wasm/jit/ir/values.js";
import { JitRegisterValues } from "#backends/wasm/jit/optimization/registers/values.js";
import {
  analyzeJitRegisterValues,
  type JitRegisterMaterialization,
  type JitRegisterValueAnalysis,
  type JitRegisterValueFold,
  type JitRegisterValueProducer
} from "#backends/wasm/jit/optimization/analyses/register-values.js";
import { analyzeJitRegisterBarriers } from "#backends/wasm/jit/optimization/analyses/barriers.js";

export type JitRegisterValuePropagation = Readonly<{
  removedSetCount: number;
  foldedReadCount: number;
  foldedAddressCount: number;
  materializedSetCount: number;
}>;

export const registerValuePropagationPass = {
  name: "register-value-propagation",
  run(block) {
    const result = propagateJitRegisterValues(block);

    return {
      block: result.block,
      changed: result.registerValues.removedSetCount !== 0 ||
        result.registerValues.foldedReadCount !== 0 ||
        result.registerValues.foldedAddressCount !== 0 ||
        result.registerValues.materializedSetCount !== 0,
      stats: result.registerValues
    };
  }
} satisfies JitOptimizationPass<"register-value-propagation">;

export function propagateJitRegisterValues(block: JitIrBlock): Readonly<{
  block: JitIrBlock;
  registerValues: JitRegisterValuePropagation;
}> {
  const barriers = analyzeJitRegisterBarriers(block);
  const analysis = analyzeJitRegisterValues(block, barriers);
  const indexes = indexRegisterValueAnalysis(analysis);
  const registers = new JitRegisterValues();
  const stats = mutableStats();
  const instructions = block.instructions.map((instruction, instructionIndex) =>
    propagateInstructionRegisterValues(instruction, instructionIndex, indexes, registers, stats)
  );

  return {
    block: { instructions },
    registerValues: stats
  };
}

function propagateInstructionRegisterValues(
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  indexes: JitRegisterValuePropagationIndexes,
  registers: JitRegisterValues,
  stats: MutableJitRegisterValuePropagation
): JitIrBlockInstruction {
  const rewrite = createJitInstructionRewrite(instruction);
  stats.materializedSetCount += emitMaterializations(
    rewrite,
    registers,
    indexes.materializationsBeforeInstruction.get(instructionIndex) ?? []
  );

  rewriteJitIrInstructionInto(
    instruction,
    instructionIndex,
    "propagating JIT register values",
    rewrite,
    ({ op, opIndex }) => {
      const key = registerValueAnalysisKey(instructionIndex, opIndex);
      const beforeExit = indexes.materializationsBeforeExit.get(key) ?? [];
      const isTerminator = jitIrOpIsTerminator(op);

      stats.materializedSetCount += emitMaterializations(
        rewrite,
        registers,
        indexes.materializationsBeforeOp.get(key) ?? []
      );

      if (isTerminator) {
        stats.materializedSetCount += emitMaterializations(rewrite, registers, beforeExit);
      }

      propagateOp(instruction, instructionIndex, op, opIndex, indexes, rewrite, registers, stats);

      if (!isTerminator) {
        stats.materializedSetCount += emitMaterializations(rewrite, registers, beforeExit);
      }
    }
  );

  return {
    ...instruction,
    ir: rewrite.ops
  };
}

function propagateOp(
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  op: JitIrOp,
  opIndex: number,
  indexes: JitRegisterValuePropagationIndexes,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues,
  stats: MutableJitRegisterValuePropagation
): void {
  switch (op.op) {
    case "get32":
      propagateGet32(instruction, instructionIndex, op, opIndex, indexes, rewrite, registers, stats);
      break;
    case "address32":
      propagateAddress32(instruction, instructionIndex, op, opIndex, indexes, rewrite, registers, stats);
      break;
    case "set32":
      propagateSet32(instruction, instructionIndex, op, opIndex, indexes, rewrite, registers, stats);
      break;
    case "set32.if":
      propagateSet32If(instruction, op, rewrite, registers);
      break;
    default:
      copyOp(instruction, op, rewrite, registers);
      break;
  }
}

function propagateGet32(
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  op: Extract<JitIrOp, { op: "get32" }>,
  opIndex: number,
  indexes: JitRegisterValuePropagationIndexes,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues,
  stats: MutableJitRegisterValuePropagation
): void {
  const fold = indexes.folds.get(registerValueAnalysisKey(instructionIndex, opIndex));

  if (fold?.kind !== "get32") {
    copyOp(instruction, op, rewrite, registers);
    return;
  }

  const value = registers.valueForStorage(op.source, instruction.operands) ?? fold.value;

  for (const reg of fold.regs) {
    registers.recordRead(reg);
  }

  assignTrackedValue(rewrite, op.dst.id, op.dst, value);
  stats.foldedReadCount += 1;
}

function propagateAddress32(
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  op: Extract<JitIrOp, { op: "address32" }>,
  opIndex: number,
  indexes: JitRegisterValuePropagationIndexes,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues,
  stats: MutableJitRegisterValuePropagation
): void {
  const fold = indexes.folds.get(registerValueAnalysisKey(instructionIndex, opIndex));

  if (fold?.kind !== "address32") {
    copyOp(instruction, op, rewrite, registers);
    return;
  }

  const value = registers.valueForEffectiveAddress(op.operand, instruction.operands) ?? fold.value;

  for (const reg of fold.regs) {
    registers.recordRead(reg);
  }

  assignTrackedValue(rewrite, op.dst.id, op.dst, value);
  stats.foldedAddressCount += 1;
}

function propagateSet32(
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  op: Extract<JitIrOp, { op: "set32" }>,
  opIndex: number,
  indexes: JitRegisterValuePropagationIndexes,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues,
  stats: MutableJitRegisterValuePropagation
): void {
  const producer = indexes.producers.get(registerValueAnalysisKey(instructionIndex, opIndex));
  const reg = producer?.reg ?? jitStorageReg(op.target, instruction.operands);

  if (producer?.retained === true) {
    const value = rewrite.values.valueFor(op.value) ?? producer.value;
    registers.set(producer.reg, value);
    registers.syncReadCounts();
    stats.removedSetCount += 1;
    return;
  }

  if (reg !== undefined) {
    registers.delete(reg);
    registers.syncReadCounts();
  }

  copyOp(instruction, op, rewrite, registers);
}

function propagateSet32If(
  instruction: JitIrBlockInstruction,
  op: Extract<JitIrOp, { op: "set32.if" }>,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues
): void {
  const reg = jitStorageReg(op.target, instruction.operands);

  if (reg !== undefined) {
    registers.delete(reg);
    registers.syncReadCounts();
  }

  copyOp(instruction, op, rewrite, registers);
}

function copyOp(
  instruction: JitIrBlockInstruction,
  op: JitIrOp,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues
): void {
  rewrite.ops.push(op);
  rewrite.values.recordOp(op, instruction, registers.trackedValues);
}

function assignTrackedValue(
  rewrite: JitInstructionRewrite,
  dstId: number,
  dst: Extract<JitIrOp, { op: "get32" | "address32" }>["dst"],
  value: JitValue
): void {
  assignJitValue(rewrite, dst, value);
  rewrite.values.record(dstId, value);
}

function emitMaterializations(
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues,
  materializations: readonly JitRegisterMaterialization[]
): number {
  let materializedSetCount = 0;

  for (const materialization of materializations) {
    for (const { reg } of materialization.values) {
      const value = registers.get(reg);

      if (value === undefined) {
        throw new Error(`missing virtual register value for materialization: ${reg}`);
      }

      materializeJitRegisterValue(rewrite, reg, value, { jitRole: "registerMaterialization" });
      registers.delete(reg);
      materializedSetCount += 1;
    }
  }

  registers.syncReadCounts();
  return materializedSetCount;
}

type JitRegisterValuePropagationIndexes = Readonly<{
  folds: ReadonlyMap<string, JitRegisterValueFold>;
  producers: ReadonlyMap<string, JitRegisterValueProducer>;
  materializationsBeforeInstruction: ReadonlyMap<number, readonly JitRegisterMaterialization[]>;
  materializationsBeforeOp: ReadonlyMap<string, readonly JitRegisterMaterialization[]>;
  materializationsBeforeExit: ReadonlyMap<string, readonly JitRegisterMaterialization[]>;
}>;

function indexRegisterValueAnalysis(
  analysis: JitRegisterValueAnalysis
): JitRegisterValuePropagationIndexes {
  const folds = new Map<string, JitRegisterValueFold>();
  const producers = new Map<string, JitRegisterValueProducer>();
  const materializationsBeforeInstruction = new Map<number, JitRegisterMaterialization[]>();
  const materializationsBeforeOp = new Map<string, JitRegisterMaterialization[]>();
  const materializationsBeforeExit = new Map<string, JitRegisterMaterialization[]>();

  for (const fold of analysis.folds) {
    folds.set(registerValueAnalysisKey(fold.instructionIndex, fold.opIndex), fold);
  }

  for (const producer of analysis.producers) {
    producers.set(registerValueAnalysisKey(producer.instructionIndex, producer.opIndex), producer);
  }

  for (const materialization of analysis.materializations) {
    switch (materialization.phase) {
      case "beforeInstruction":
        appendInstructionMaterialization(materializationsBeforeInstruction, materialization);
        break;
      case "beforeOp":
      case "blockEnd":
        appendOpMaterialization(materializationsBeforeOp, materialization);
        break;
      case "beforeExit":
        appendOpMaterialization(materializationsBeforeExit, materialization);
        break;
    }
  }

  return {
    folds,
    producers,
    materializationsBeforeInstruction,
    materializationsBeforeOp,
    materializationsBeforeExit
  };
}

function appendInstructionMaterialization(
  materializationsByInstruction: Map<number, JitRegisterMaterialization[]>,
  materialization: JitRegisterMaterialization
): void {
  const instructionMaterializations = materializationsByInstruction.get(materialization.instructionIndex);

  if (instructionMaterializations === undefined) {
    materializationsByInstruction.set(materialization.instructionIndex, [materialization]);
  } else {
    instructionMaterializations.push(materialization);
  }
}

function appendOpMaterialization(
  materializationsByOp: Map<string, JitRegisterMaterialization[]>,
  materialization: JitRegisterMaterialization
): void {
  if (materialization.opIndex === undefined) {
    throw new Error(`missing op index for register materialization: ${materialization.instructionIndex}`);
  }

  const key = registerValueAnalysisKey(materialization.instructionIndex, materialization.opIndex);
  const opMaterializations = materializationsByOp.get(key);

  if (opMaterializations === undefined) {
    materializationsByOp.set(key, [materialization]);
  } else {
    opMaterializations.push(materialization);
  }
}

function registerValueAnalysisKey(instructionIndex: number, opIndex: number): string {
  return `${instructionIndex}:${opIndex}`;
}

type MutableJitRegisterValuePropagation = {
  removedSetCount: number;
  foldedReadCount: number;
  foldedAddressCount: number;
  materializedSetCount: number;
};

function mutableStats(): MutableJitRegisterValuePropagation {
  return {
    removedSetCount: 0,
    foldedReadCount: 0,
    foldedAddressCount: 0,
    materializedSetCount: 0
  };
}
