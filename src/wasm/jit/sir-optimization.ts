import {
  SIR_ALU_FLAG_MASK
} from "../../arch/x86/sir/flag-analysis.js";
import {
  createFlagBoundaryInsertionPass,
  createDeadFlagSetPruningPass,
  createFlagMaterializationPass,
  type SirFlagBoundaryPoint
} from "../../arch/x86/sir/flag-optimization.js";
import { optimizeSirProgram } from "../../arch/x86/sir/optimization.js";
import type { SirOp, SirProgram, StorageRef } from "../../arch/x86/sir/types.js";
import type { JitOperandBinding } from "./operand-bindings.js";
import type { JitSirBlock } from "./types.js";

export function optimizeJitSirBlock(block: JitSirBlock): JitSirBlock {
  const optimized = optimizeSirProgram(block.sir, [
    createFlagBoundaryInsertionPass({
      points: (program) => jitFlagBoundaryPoints(program, block.operands)
    }),
    createDeadFlagSetPruningPass(),
    createFlagMaterializationPass()
  ]);

  return {
    sir: optimized.program,
    operands: block.operands,
    instructions: block.instructions
  };
}

function jitFlagBoundaryPoints(
  program: SirProgram,
  operands: readonly JitOperandBinding[]
): readonly SirFlagBoundaryPoint[] {
  const points: SirFlagBoundaryPoint[] = [];

  for (let index = 0; index < program.length; index += 1) {
    const op = program[index];

    if (op === undefined) {
      throw new Error(`missing SIR op while planning JIT flag boundaries: ${index}`);
    }

    if (opMayFaultBeforeCompletion(op, operands)) {
      points.push({ index, placement: "before", mask: SIR_ALU_FLAG_MASK });
    }
  }

  if (program.length !== 0) {
    points.push({
      index: program.length - 1,
      placement: "before",
      mask: SIR_ALU_FLAG_MASK
    });
  }

  return points;
}

function opMayFaultBeforeCompletion(op: SirOp, operands: readonly JitOperandBinding[]): boolean {
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
