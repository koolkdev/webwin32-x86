import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import {
  indexJitOptimizationBoundaries,
  jitBoundariesAt,
  type JitOptimizationBoundaryIndex
} from "./boundaries.js";
import { walkJitIrBlockOps } from "./ir-walk.js";
import {
  analyzeJitConditionUses,
  indexJitExitConditionValues,
  indexJitLocalConditionValues,
  type JitConditionUse,
  type JitConditionUseIndex,
  type JitExitConditionValueIndex,
  type JitLocalConditionValueIndex
} from "./condition-uses.js";
import { jitMemoryFaultReason, jitPostInstructionExitReasons } from "./op-effects.js";

export type JitOpIndex<T> = ReadonlyMap<number, ReadonlyMap<number, T>>;

export type JitPreInstructionExitIndex = JitOpIndex<ExitReasonValue>;
export type JitPostInstructionExitIndex = JitOpIndex<readonly ExitReasonValue[]>;

export type JitOptimizationAnalysis = Readonly<{
  preInstructionExits: JitPreInstructionExitIndex;
  postInstructionExits: JitPostInstructionExitIndex;
  localConditionValues: JitLocalConditionValueIndex;
  exitConditionValues: JitExitConditionValueIndex;
  conditionUses: JitConditionUseIndex;
  boundaries: JitOptimizationBoundaryIndex;
}>;

export function analyzeJitOptimization(block: JitIrBlock): JitOptimizationAnalysis {
  const localConditionValues = indexJitLocalConditionValues(block);
  const exitConditionValues = indexJitExitConditionValues(block);
  const analysisWithoutBoundaries = {
    preInstructionExits: indexJitPreInstructionExits(block),
    postInstructionExits: indexJitPostInstructionExits(block),
    localConditionValues,
    exitConditionValues,
    conditionUses: analyzeJitConditionUses(block, localConditionValues, exitConditionValues)
  };

  return {
    ...analysisWithoutBoundaries,
    boundaries: indexJitOptimizationBoundaries(analysisWithoutBoundaries)
  };
}

export function jitPreInstructionExitReasonAt(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number,
  opIndex: number
): ExitReasonValue | undefined {
  const boundary = jitBoundariesAt(analysis.boundaries, instructionIndex, opIndex).find((entry) =>
    entry.kind === "preInstructionExit"
  );

  return boundary?.kind === "preInstructionExit" ? boundary.exitReason : undefined;
}

export function jitPostInstructionExitReasonsAt(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number,
  opIndex: number
): readonly ExitReasonValue[] {
  const boundary = jitBoundariesAt(analysis.boundaries, instructionIndex, opIndex).find((entry) =>
    entry.kind === "postInstructionExit"
  );

  return boundary?.kind === "postInstructionExit" ? boundary.exitReasons : [];
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
  const boundary = jitBoundariesAt(analysis.boundaries, instructionIndex, opIndex).find((entry) =>
    entry.kind === "conditionRead"
  );

  return boundary?.kind === "conditionRead" ? boundary.conditionUse : undefined;
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
      setIndexedOpValue(preInstructionExits, location.instructionIndex, location.opIndex, faultReason);
    }
  }, "indexing pre-instruction exits");

  return preInstructionExits;
}

function indexJitPostInstructionExits(block: JitIrBlock): JitPostInstructionExitIndex {
  const postInstructionExits = new Map<number, Map<number, readonly ExitReasonValue[]>>();

  walkJitIrBlockOps(block, (instruction, op, location) => {
    const exitReasons = jitPostInstructionExitReasons(op, instruction);

    if (exitReasons.length !== 0) {
      setIndexedOpValue(postInstructionExits, location.instructionIndex, location.opIndex, exitReasons);
    }
  }, "indexing post-instruction exits");

  return postInstructionExits;
}

function setIndexedOpValue<T>(
  index: Map<number, Map<number, T>>,
  instructionIndex: number,
  opIndex: number,
  value: T
): void {
  let instructionValues = index.get(instructionIndex);

  if (instructionValues === undefined) {
    instructionValues = new Map();
    index.set(instructionIndex, instructionValues);
  }

  instructionValues.set(opIndex, value);
}
