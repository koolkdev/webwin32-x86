import type { JitIrBlock, JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import type { JitOptimizationPass } from "#backends/wasm/jit/optimization/pass.js";
import {
  analyzeJitFlagLiveness,
  jitFlagLivenessOpAt
} from "#backends/wasm/jit/optimization/analyses/flag-liveness.js";

export type JitFlagDce = Readonly<{
  removedSetCount: number;
  retainedSetCount: number;
}>;

export const flagDcePass: JitOptimizationPass = {
  name: "flag-dce",
  run(block) {
    const result = pruneDeadJitFlagSets(block);

    return {
      block: result.block,
      changed: result.flagDce.removedSetCount !== 0,
      stats: result.flagDce
    };
  }
};

export function pruneDeadJitFlagSets(block: JitIrBlock): Readonly<{
  block: JitIrBlock;
  flagDce: JitFlagDce;
}> {
  const liveness = analyzeJitFlagLiveness(block);
  let removedSetCount = 0;
  let retainedSetCount = 0;
  const instructions = block.instructions.map((instruction, instructionIndex) => {
    const rewritten = pruneInstructionDeadFlagSets(instruction, instructionIndex, liveness);

    removedSetCount += rewritten.removedSetCount;
    retainedSetCount += rewritten.retainedSetCount;
    return rewritten.instruction;
  });

  return {
    block: { instructions },
    flagDce: { removedSetCount, retainedSetCount }
  };
}

function pruneInstructionDeadFlagSets(
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  liveness: ReturnType<typeof analyzeJitFlagLiveness>
): Readonly<{
  instruction: JitIrBlockInstruction;
  removedSetCount: number;
  retainedSetCount: number;
}> {
  const ops: JitIrOp[] = [];
  let removedSetCount = 0;
  let retainedSetCount = 0;

  for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
    const op = instruction.ir[opIndex];

    if (op === undefined) {
      throw new Error(`missing JIT IR op while pruning dead flag sets: ${instructionIndex}:${opIndex}`);
    }

    if (op.op === "flags.set") {
      if (!jitFlagLivenessOpAt(liveness, instructionIndex, opIndex).keptFlagSet) {
        removedSetCount += 1;
        continue;
      }

      retainedSetCount += 1;
    }

    ops.push(op);
  }

  return {
    instruction: {
      ...instruction,
      ir: ops
    },
    removedSetCount,
    retainedSetCount
  };
}
