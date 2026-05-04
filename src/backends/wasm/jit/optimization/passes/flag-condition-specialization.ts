import { flagProducerConditionInputNames } from "#x86/ir/model/flag-conditions.js";
import type { ValueRef } from "#x86/ir/model/types.js";
import type { JitIrBlock, JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/ir/types.js";
import { indexJitEffects } from "#backends/wasm/jit/ir/effects.js";
import type { JitOptimizationPass } from "#backends/wasm/jit/optimization/pass.js";
import { analyzeJitBarriers } from "#backends/wasm/jit/ir/barriers.js";
import { analyzeJitReachingFlags } from "#backends/wasm/jit/optimization/analyses/reaching-flags.js";
import {
  indexDirectFlagConditions,
  type JitDirectFlagCondition
} from "#backends/wasm/jit/optimization/analyses/direct-flag-conditions.js";
import {
  createJitInstructionRewrite,
  emitJitValueRef,
  rewriteJitIrInstructionInto
} from "#backends/wasm/jit/ir/rewrite.js";

export type JitFlagConditionSpecialization = Readonly<{
  directConditionCount: number;
}>;

export const flagConditionSpecializationPass = {
  name: "flagConditionSpecialization",
  run(block) {
    const result = specializeJitFlagConditions(block);

    return {
      block: result.block,
      changed: result.flagConditionSpecialization.directConditionCount !== 0,
      stats: result.flagConditionSpecialization
    };
  }
} satisfies JitOptimizationPass<"flagConditionSpecialization">;

export function specializeJitFlagConditions(block: JitIrBlock): Readonly<{
  block: JitIrBlock;
  flagConditionSpecialization: JitFlagConditionSpecialization;
}> {
  const effects = indexJitEffects(block);
  const barriers = analyzeJitBarriers(block, effects);
  const reachingFlags = analyzeJitReachingFlags(block, barriers);
  const directConditions = indexDirectFlagConditions(block, reachingFlags);
  let directConditionCount = 0;
  const instructions = block.instructions.map((instruction, instructionIndex) => {
    const rewritten = specializeInstructionFlagConditions(instruction, instructionIndex, directConditions);

    directConditionCount += rewritten.directConditionCount;
    return rewritten.instruction;
  });

  return {
    block: { instructions },
    flagConditionSpecialization: { directConditionCount }
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

function emitDirectFlagCondition(
  rewrite: ReturnType<typeof createJitInstructionRewrite>,
  op: Extract<JitIrOp, { op: "aluFlags.condition" }>,
  condition: JitDirectFlagCondition
): void {
  const inputs: Record<string, ValueRef> = {};
  const inputNames = flagProducerConditionInputNames({
    producer: condition.source.producer,
    cc: op.cc,
    inputs: flagConditionInputShape(condition)
  });

  for (const inputName of inputNames) {
    const input = condition.inputs[inputName];

    if (input?.kind !== "value") {
      throw new Error(`missing modeled flag condition input '${inputName}' for ${condition.source.producer}/${op.cc}`);
    }

    inputs[inputName] = emitJitValueRef(rewrite, input.value);
  }

  rewrite.ops.push({
    op: "flagProducer.condition",
    dst: op.dst,
    cc: op.cc,
    producer: condition.source.producer,
    writtenMask: condition.source.writtenMask,
    undefMask: condition.source.undefMask,
    inputs
  });
}

function flagConditionInputShape(condition: JitDirectFlagCondition): Readonly<Record<string, ValueRef>> {
  const inputs: Record<string, ValueRef> = {};

  for (const inputName of condition.inputNames) {
    inputs[inputName] = { kind: "const32", value: 0 };
  }

  return inputs;
}
