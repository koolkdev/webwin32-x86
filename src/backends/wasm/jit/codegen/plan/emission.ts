import {
  buildIrExpressionBlock,
  type IrExpressionOptions,
  type IrExprBlock
} from "#backends/wasm/codegen/expressions.js";
import type { JitIrBlock, JitIrBlockInstruction } from "#backends/wasm/jit/ir/types.js";
import {
  canInlineJitInstructionGet,
  jitInstructionStorageRefsMayAlias
} from "./operand-analysis.js";
import {
  planJitExpressionValueCache,
  type JitExpressionValueCachePlan
} from "./value-cache.js";
import type {
  JitCodegenPlan,
  JitExitPoint,
  JitExitState,
  JitFlagMaterializationRequirement,
  JitInstructionState
} from "./types.js";

export type JitCodegenInstructionPlan = JitInstructionState & Pick<
  JitIrBlockInstruction,
  "operands"
> & Readonly<{
  expressionBlock: IrExprBlock;
  valueCachePlan?: JitExpressionValueCachePlan;
}>;

export type JitCodegenEmissionPlan = Readonly<{
  instructions: readonly JitCodegenInstructionPlan[];
  exitPoints: readonly JitExitPoint[];
  flagMaterializationRequirements: readonly JitFlagMaterializationRequirement[];
  exitStates: readonly JitExitState[];
  maxExitStateIndex: number;
}>;

export function buildJitCodegenEmissionPlan(
  block: JitIrBlock,
  codegenPlan: JitCodegenPlan
): JitCodegenEmissionPlan {
  if (block.instructions.length !== codegenPlan.instructionStates.length) {
    throw new Error(
      `JIT codegen instruction count mismatch: ${block.instructions.length} !== ${codegenPlan.instructionStates.length}`
    );
  }

  return {
    instructions: block.instructions.map((instruction, index) => {
      const state = codegenPlan.instructionStates[index];

      if (state === undefined) {
        throw new Error(`missing JIT instruction state for codegen: ${index}`);
      }

      const expressionBlock = buildIrExpressionBlock(instruction.ir, jitExpressionOptions(instruction));
      const valueCachePlan = planJitExpressionValueCache(instruction, expressionBlock);

      return {
        ...state,
        operands: instruction.operands,
        expressionBlock,
        ...(valueCachePlan === undefined ? {} : { valueCachePlan })
      };
    }),
    exitPoints: codegenPlan.exitPoints,
    flagMaterializationRequirements: codegenPlan.flagMaterializationRequirements,
    exitStates: codegenPlan.exitStates,
    maxExitStateIndex: codegenPlan.maxExitStateIndex
  };
}

function jitExpressionOptions(instruction: Pick<JitIrBlockInstruction, "operands">): IrExpressionOptions {
  return {
    canInlineGet: (source) => canInlineJitInstructionGet(instruction, source),
    alias: {
      storageMayAlias: (write, read) => jitInstructionStorageRefsMayAlias(instruction, write, read)
    }
  };
}
