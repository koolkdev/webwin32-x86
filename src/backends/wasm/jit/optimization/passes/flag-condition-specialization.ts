import type { JitIrBlock, JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import type { JitOptimizationPass } from "#backends/wasm/jit/optimization/pass.js";
import { analyzeJitReachingFlags } from "#backends/wasm/jit/optimization/analyses/reaching-flags.js";
import { indexDirectFlagConditions } from "#backends/wasm/jit/optimization/analyses/direct-flag-conditions.js";
import { emitDirectFlagCondition } from "#backends/wasm/jit/optimization/flags/conditions.js";
import {
  createJitInstructionRewrite,
  rewriteJitIrInstructionInto
} from "#backends/wasm/jit/ir/rewrite.js";

export type JitFlagConditionSpecialization = Readonly<{
  directConditionCount: number;
}>;

export const flagConditionSpecializationPass = {
  name: "flag-condition-specialization",
  run(block) {
    const result = specializeJitFlagConditions(block);

    return {
      block: result.block,
      changed: result.flagConditions.directConditionCount !== 0,
      stats: result.flagConditions
    };
  }
} satisfies JitOptimizationPass<"flag-condition-specialization">;

export function specializeJitFlagConditions(block: JitIrBlock): Readonly<{
  block: JitIrBlock;
  flagConditions: JitFlagConditionSpecialization;
}> {
  const reachingFlags = analyzeJitReachingFlags(block);
  const directConditions = indexDirectFlagConditions(block, reachingFlags);
  let directConditionCount = 0;
  const instructions = block.instructions.map((instruction, instructionIndex) => {
    const rewritten = specializeInstructionFlagConditions(instruction, instructionIndex, directConditions);

    directConditionCount += rewritten.directConditionCount;
    return rewritten.instruction;
  });

  return {
    block: { instructions },
    flagConditions: { directConditionCount }
  };
}

function specializeInstructionFlagConditions(
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  directConditions: ReturnType<typeof indexDirectFlagConditions>
): Readonly<{
  instruction: JitIrBlockInstruction;
  directConditionCount: number;
}> {
  const rewrite = createJitInstructionRewrite(instruction);
  let directConditionCount = 0;

  rewriteJitIrInstructionInto(
    instruction,
    instructionIndex,
    "specializing JIT flag conditions",
    rewrite,
    ({ op, opIndex }) => {
      if (op.op === "aluFlags.condition") {
        const directCondition = directConditions.get(instructionIndex)?.get(opIndex);

        if (directCondition !== undefined) {
          emitDirectFlagCondition(rewrite, op, directCondition);
          directConditionCount += 1;
          return;
        }
      }

      recordCopiedOp(rewrite, instruction, op);
    }
  );

  return {
    instruction: {
      ...instruction,
      ir: rewrite.ops
    },
    directConditionCount
  };
}

function recordCopiedOp(
  rewrite: ReturnType<typeof createJitInstructionRewrite>,
  instruction: JitIrBlockInstruction,
  op: JitIrOp
): void {
  rewrite.values.recordOp(op, instruction);
  rewrite.ops.push(op);
}
