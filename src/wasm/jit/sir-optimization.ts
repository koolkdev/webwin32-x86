import {
  SIR_ARITHMETIC_FLAG_MASK,
  type SirFlagLivenessBarrier
} from "../../arch/x86/sir/flag-analysis.js";
import {
  createDeadFlagSetPruningPass,
  createFlagMaterializationPass,
  type SirFlagMaterializationPoint
} from "../../arch/x86/sir/flag-optimization.js";
import { optimizeSirProgram } from "../../arch/x86/sir/optimization.js";
import type { SirOp, SirProgram, StorageRef } from "../../arch/x86/sir/types.js";
import type { JitOperandBinding } from "./operand-bindings.js";
import type { JitSirBlock } from "./types.js";

export function optimizeJitSirBlock(block: JitSirBlock): JitSirBlock {
  const optimized = optimizeSirProgram(block.sir, [
    (program) =>
      createDeadFlagSetPruningPass({
        liveOut: SIR_ARITHMETIC_FLAG_MASK,
        barriers: jitFlagLivenessBarriers(program, block.operands)
      })(program),
    (program) =>
      createFlagMaterializationPass({
        points: jitFlagMaterializationPoints(program, block.operands)
      })(program)
  ]);

  return {
    sir: optimized.program,
    operands: block.operands,
    instructions: block.instructions
  };
}

function jitFlagMaterializationPoints(
  program: SirProgram,
  operands: readonly JitOperandBinding[]
): readonly SirFlagMaterializationPoint[] {
  const points: SirFlagMaterializationPoint[] = [];

  for (const barrier of jitFlagLivenessBarriers(program, operands)) {
    points.push({ index: barrier.index, placement: "before", mask: barrier.mask });
  }

  if (program.length !== 0) {
    points.push({
      index: program.length - 1,
      placement: "before",
      mask: SIR_ARITHMETIC_FLAG_MASK
    });
  }

  return points;
}

function jitFlagLivenessBarriers(
  program: SirProgram,
  operands: readonly JitOperandBinding[]
): readonly SirFlagLivenessBarrier[] {
  const barriers: SirFlagLivenessBarrier[] = [];

  for (let index = 0; index < program.length; index += 1) {
    const op = program[index];

    if (op === undefined) {
      throw new Error(`missing SIR op while planning JIT flag barriers: ${index}`);
    }

    if (opMayFaultBeforeCompletion(op, operands)) {
      barriers.push({ index, placement: "before", mask: SIR_ARITHMETIC_FLAG_MASK });
    }
  }

  return barriers;
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
