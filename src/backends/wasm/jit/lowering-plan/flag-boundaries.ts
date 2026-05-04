import type { JitLoweringPlan } from "#backends/wasm/jit/lowering-plan/types.js";
import type { JitIrBlock, JitIrBody, JitIrOp } from "#backends/wasm/jit/types.js";

const emptyBoundaryMaskByOpIndex = new Map<number, number>();

export function insertJitFlagBoundaries(
  block: JitIrBlock,
  loweringPlan: JitLoweringPlan
): JitIrBlock {
  const boundaryMasks = jitFlagBoundaryMasks(loweringPlan);

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

export function jitFlagBoundaryMasks(
  loweringPlan: JitLoweringPlan
): ReadonlyMap<number, ReadonlyMap<number, number>> {
  const masks = new Map<number, Map<number, number>>();

  for (let instructionIndex = 0; instructionIndex < loweringPlan.instructionStates.length; instructionIndex += 1) {
    const state = loweringPlan.instructionStates[instructionIndex];

    if (state === undefined) {
      throw new Error(`missing JIT instruction state while inserting flag boundaries: ${instructionIndex}`);
    }

    if (state.preInstructionExitPointCount !== 0) {
      addBoundaryMask(masks, instructionIndex, 0, state.preInstructionState.speculativeFlags.mask);
    }
  }

  for (const exit of loweringPlan.exitPoints) {
    if (exit.snapshot.kind === "preInstruction") {
      continue;
    }

    addBoundaryMask(masks, exit.instructionIndex, exit.opIndex, exit.requiredFlagCommitMask);
  }

  return masks;
}

function addBoundaryMask(
  masks: Map<number, Map<number, number>>,
  instructionIndex: number,
  opIndex: number,
  mask: number
): void {
  if (mask === 0) {
    return;
  }

  let instructionMasks = masks.get(instructionIndex);

  if (instructionMasks === undefined) {
    instructionMasks = new Map();
    masks.set(instructionIndex, instructionMasks);
  }

  instructionMasks.set(opIndex, (instructionMasks.get(opIndex) ?? 0) | mask);
}

function insertInstructionFlagBoundaries(
  block: JitIrBody,
  boundaryMasks: ReadonlyMap<number, number>
): JitIrBody {
  const ops: JitIrOp[] = [];

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
