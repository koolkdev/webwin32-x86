import { IR_ALU_FLAG_MASK } from "#x86/ir/passes/flag-analysis.js";
import { createFlagMaterializationPass } from "#x86/ir/passes/flag-optimization.js";
import { optimizeIrBlock } from "#x86/ir/passes/optimization.js";
import type { IrBlock, IrOp } from "#x86/ir/model/types.js";
import { optimizeJitIrBlock, type JitBlockOptimization } from "#backends/wasm/jit/optimization/optimize.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";

const emptyBoundaryMaskByOpIndex = new Map<number, number>();

export function prepareJitIrBlockForLowering(
  block: JitIrBlock,
  optimization: JitBlockOptimization = optimizeJitIrBlock(block)
): JitIrBlock {
  return insertInstructionFlagMaterializations(insertExitFlagBoundaries(block, optimization));
}

function insertInstructionFlagMaterializations(block: JitIrBlock): JitIrBlock {
  return {
    instructions: block.instructions.map((instruction) => ({
      ...instruction,
      ir: optimizeIrBlock(instruction.ir, [
        createFlagMaterializationPass()
      ]).block
    }))
  };
}

function insertExitFlagBoundaries(block: JitIrBlock, optimization: JitBlockOptimization): JitIrBlock {
  const boundaryMasks = exitFlagBoundaryMasks(optimization);

  if (boundaryMasks.size === 0) {
    return block;
  }

  return {
    instructions: block.instructions.map((instruction, instructionIndex) => ({
      ...instruction,
      ir: insertInstructionFlagBoundaries(
        instruction.ir,
        boundaryMasks.get(instructionIndex) ?? emptyBoundaryMaskByOpIndex
      )
    }))
  };
}

function exitFlagBoundaryMasks(optimization: JitBlockOptimization): ReadonlyMap<number, ReadonlyMap<number, number>> {
  const masks = new Map<number, Map<number, number>>();

  for (const exit of optimization.exitPoints) {
    let instructionMasks = masks.get(exit.instructionIndex);

    if (instructionMasks === undefined) {
      instructionMasks = new Map();
      masks.set(exit.instructionIndex, instructionMasks);
    }

    instructionMasks.set(exit.opIndex, (instructionMasks.get(exit.opIndex) ?? 0) | IR_ALU_FLAG_MASK);
  }

  return masks;
}

function insertInstructionFlagBoundaries(
  block: IrBlock,
  boundaryMasks: ReadonlyMap<number, number>
): IrBlock {
  const ops: IrOp[] = [];

  for (let index = 0; index < block.length; index += 1) {
    const boundaryMask = boundaryMasks.get(index);

    if (boundaryMask !== undefined) {
      ops.push({ op: "flags.boundary", mask: boundaryMask });
    }

    const op = block[index];

    if (op === undefined) {
      throw new Error(`missing JIT IR op while inserting JIT exit flag boundary: ${index}`);
    }

    ops.push(op);
  }

  return ops;
}
