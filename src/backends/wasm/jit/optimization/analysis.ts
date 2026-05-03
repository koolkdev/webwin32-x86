import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import {
  indexJitOptimizationBoundaries,
  jitBoundaryAt,
  type JitOptimizationBoundaryIndex
} from "./boundaries.js";
import type { JitConditionUse } from "./condition-uses.js";

export type JitOptimizationAnalysis = Readonly<{
  boundaries: JitOptimizationBoundaryIndex;
}>;

export function analyzeJitOptimization(block: JitIrBlock): JitOptimizationAnalysis {
  return {
    boundaries: indexJitOptimizationBoundaries(block)
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
