import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import {
  indexJitOptimizationBoundaries,
  jitBoundaryAt,
  type JitOptimizationBoundaryIndex
} from "./boundaries.js";
import { walkJitIrBlockOps } from "./ir-walk.js";
import {
  analyzeJitConditionUses,
  indexJitExitConditionValues,
  indexJitLocalConditionValues,
  type JitConditionUse
} from "./condition-uses.js";
import { jitMemoryFaultReason, jitPostInstructionExitReasons } from "./op-effects.js";
import { setJitOpIndexValue, type JitOpIndex } from "./op-index.js";

export type JitPreInstructionExitIndex = JitOpIndex<ExitReasonValue>;
export type JitPostInstructionExitIndex = JitOpIndex<readonly ExitReasonValue[]>;

export type JitOptimizationAnalysis = Readonly<{
  boundaries: JitOptimizationBoundaryIndex;
}>;

export function analyzeJitOptimization(block: JitIrBlock): JitOptimizationAnalysis {
  const localConditionValues = indexJitLocalConditionValues(block);
  const exitConditionValues = indexJitExitConditionValues(block);
  const boundarySources = {
    preInstructionExits: indexJitPreInstructionExits(block),
    postInstructionExits: indexJitPostInstructionExits(block),
    localConditionValues,
    exitConditionValues,
    conditionUses: analyzeJitConditionUses(block, localConditionValues, exitConditionValues)
  };

  return {
    boundaries: indexJitOptimizationBoundaries(boundarySources)
  };
}

export function jitPreInstructionExitReasonAt(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number,
  opIndex: number
): ExitReasonValue | undefined {
  return jitBoundaryAt(analysis.boundaries, instructionIndex, opIndex, "preInstructionExit")?.exitReason;
}

export function jitPostInstructionExitReasonsAt(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number,
  opIndex: number
): readonly ExitReasonValue[] {
  return jitBoundaryAt(analysis.boundaries, instructionIndex, opIndex, "postInstructionExit")?.exitReasons ?? [];
}

export function jitOpHasPostInstructionExit(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number,
  opIndex: number
): boolean {
  return jitPostInstructionExitReasonsAt(analysis, instructionIndex, opIndex).length !== 0;
}

export function jitConditionUseAt(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number,
  opIndex: number
): JitConditionUse | undefined {
  return jitBoundaryAt(analysis.boundaries, instructionIndex, opIndex, "conditionRead")?.conditionUse;
}

export function jitInstructionHasPreInstructionExit(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number
): boolean {
  for (const boundaries of analysis.boundaries.get(instructionIndex)?.values() ?? []) {
    if (boundaries.some((entry) => entry.kind === "preInstructionExit")) {
      return true;
    }
  }

  return false;
}

function indexJitPreInstructionExits(block: JitIrBlock): JitPreInstructionExitIndex {
  const preInstructionExits = new Map<number, Map<number, ExitReasonValue>>();

  walkJitIrBlockOps(block, (instruction, op, location) => {
    const faultReason = jitMemoryFaultReason(op, instruction.operands);

    if (faultReason !== undefined) {
      setJitOpIndexValue(preInstructionExits, location.instructionIndex, location.opIndex, faultReason);
    }
  }, "indexing pre-instruction exits");

  return preInstructionExits;
}

function indexJitPostInstructionExits(block: JitIrBlock): JitPostInstructionExitIndex {
  const postInstructionExits = new Map<number, Map<number, readonly ExitReasonValue[]>>();

  walkJitIrBlockOps(block, (instruction, op, location) => {
    const exitReasons = jitPostInstructionExitReasons(op, instruction);

    if (exitReasons.length !== 0) {
      setJitOpIndexValue(postInstructionExits, location.instructionIndex, location.opIndex, exitReasons);
    }
  }, "indexing post-instruction exits");

  return postInstructionExits;
}
