import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import {
  indexJitOptimizationBoundaries,
  jitConditionUseAt as jitBoundaryConditionUseAt,
  jitInstructionHasPreInstructionExit as jitBoundaryInstructionHasPreInstructionExit,
  jitOpHasPostInstructionExit as jitBoundaryOpHasPostInstructionExit,
  jitPostInstructionExitReasonsAt as jitBoundaryPostInstructionExitReasonsAt,
  jitPreInstructionExitReasonAt as jitBoundaryPreInstructionExitReasonAt,
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
  return jitBoundaryPreInstructionExitReasonAt(analysis.boundaries, instructionIndex, opIndex);
}

export function jitPostInstructionExitReasonsAt(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number,
  opIndex: number
): readonly ExitReasonValue[] {
  return jitBoundaryPostInstructionExitReasonsAt(analysis.boundaries, instructionIndex, opIndex);
}

export function jitOpHasPostInstructionExit(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number,
  opIndex: number
): boolean {
  return jitBoundaryOpHasPostInstructionExit(analysis.boundaries, instructionIndex, opIndex);
}

export function jitConditionUseAt(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number,
  opIndex: number
): JitConditionUse | undefined {
  return jitBoundaryConditionUseAt(analysis.boundaries, instructionIndex, opIndex);
}

export function jitInstructionHasPreInstructionExit(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number
): boolean {
  return jitBoundaryInstructionHasPreInstructionExit(analysis.boundaries, instructionIndex);
}
