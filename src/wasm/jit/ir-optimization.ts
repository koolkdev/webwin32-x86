import {
  IR_ALU_FLAG_MASK
} from "../../arch/x86/ir/flag-analysis.js";
import {
  createFlagBoundaryInsertionPass,
  createAluFlagsConditionSpecializationPass,
  createDeadFlagSetPruningPass,
  createFlagMaterializationPass,
  type IrFlagBoundaryPoint
} from "../../arch/x86/ir/flag-optimization.js";
import { optimizeIrProgram } from "../../arch/x86/ir/optimization.js";
import type { IrOp, IrProgram, StorageRef } from "../../arch/x86/ir/types.js";
import type { JitOperandBinding } from "./operand-bindings.js";
import type { JitIrBlock } from "./types.js";

export function optimizeJitIrBlock(block: JitIrBlock): JitIrBlock {
  const optimized = optimizeIrProgram(block.ir, [
    createFlagBoundaryInsertionPass({
      points: (program) => jitFlagBoundaryPoints(program, block.operands)
    }),
    createAluFlagsConditionSpecializationPass(),
    createDeadFlagSetPruningPass(),
    createFlagMaterializationPass()
  ]);

  return {
    ir: optimized.program,
    operands: block.operands,
    instructions: block.instructions
  };
}

function jitFlagBoundaryPoints(
  program: IrProgram,
  operands: readonly JitOperandBinding[]
): readonly IrFlagBoundaryPoint[] {
  const points: IrFlagBoundaryPoint[] = [];

  for (let index = 0; index < program.length; index += 1) {
    const op = program[index];

    if (op === undefined) {
      throw new Error(`missing IR op while planning JIT flag boundaries: ${index}`);
    }

    if (opMayFaultBeforeCompletion(op, operands)) {
      points.push({ index, placement: "before", mask: IR_ALU_FLAG_MASK });
    }
  }

  if (program.length !== 0) {
    points.push({
      index: program.length - 1,
      placement: "before",
      mask: IR_ALU_FLAG_MASK
    });
  }

  return points;
}

function opMayFaultBeforeCompletion(op: IrOp, operands: readonly JitOperandBinding[]): boolean {
  switch (op.op) {
    case "get32":
      return storageMayAccessMemory(op.source, operands);
    case "set32":
      return storageMayAccessMemory(op.target, operands);
    default:
      return false;
  }
}

function storageMayAccessMemory(storage: StorageRef, operands: readonly JitOperandBinding[]): boolean {
  switch (storage.kind) {
    case "mem":
      return true;
    case "reg":
      return false;
    case "operand":
      return operands[storage.index]?.kind === "static.mem32";
  }
}
