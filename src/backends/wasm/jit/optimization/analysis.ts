import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
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
}>;

export function analyzeJitOptimization(block: JitIrBlock): JitOptimizationAnalysis {
  const localConditionValues = indexJitLocalConditionValues(block);
  const exitConditionValues = indexJitExitConditionValues(block);

  return {
    preInstructionExits: indexJitPreInstructionExits(block),
    postInstructionExits: indexJitPostInstructionExits(block),
    localConditionValues,
    exitConditionValues,
    conditionUses: analyzeJitConditionUses(block, localConditionValues, exitConditionValues)
  };
}

export function jitPreInstructionExitReasonAt(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number,
  opIndex: number
): ExitReasonValue | undefined {
  return indexedOpValue(analysis.preInstructionExits, instructionIndex, opIndex);
}

export function jitPostInstructionExitReasonsAt(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number,
  opIndex: number
): readonly ExitReasonValue[] {
  return indexedOpValue(analysis.postInstructionExits, instructionIndex, opIndex) ?? [];
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
  return indexedOpValue(analysis.conditionUses, instructionIndex, opIndex);
}

export function jitInstructionHasPreInstructionExit(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number
): boolean {
  return (analysis.preInstructionExits.get(instructionIndex)?.size ?? 0) !== 0;
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

function indexedOpValue<T>(
  index: JitOpIndex<T>,
  instructionIndex: number,
  opIndex: number
): T | undefined {
  return index.get(instructionIndex)?.get(opIndex);
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
