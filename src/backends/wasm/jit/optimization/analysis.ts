import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
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

export type JitPreInstructionMemoryFaultIndex = JitOpIndex<ExitReasonValue>;
export type JitPostInstructionExitIndex = JitOpIndex<readonly ExitReasonValue[]>;

export type JitOptimizationAnalysis = Readonly<{
  preInstructionMemoryFaults: JitPreInstructionMemoryFaultIndex;
  postInstructionExits: JitPostInstructionExitIndex;
  localConditionValues: JitLocalConditionValueIndex;
  exitConditionValues: JitExitConditionValueIndex;
  conditionUses: JitConditionUseIndex;
}>;

export function analyzeJitOptimization(block: JitIrBlock): JitOptimizationAnalysis {
  const localConditionValues = indexJitLocalConditionValues(block);
  const exitConditionValues = indexJitExitConditionValues(block);

  return {
    preInstructionMemoryFaults: indexJitPreInstructionMemoryFaults(block),
    postInstructionExits: indexJitPostInstructionExits(block),
    localConditionValues,
    exitConditionValues,
    conditionUses: analyzeJitConditionUses(block, localConditionValues, exitConditionValues)
  };
}

export function jitMemoryFaultAt(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number,
  opIndex: number
): ExitReasonValue | undefined {
  return indexedOpValue(analysis.preInstructionMemoryFaults, instructionIndex, opIndex);
}

export function jitPostInstructionExitReasonsAt(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number,
  opIndex: number
): readonly ExitReasonValue[] {
  return indexedOpValue(analysis.postInstructionExits, instructionIndex, opIndex) ?? [];
}

export function jitConditionUseAt(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number,
  opIndex: number
): JitConditionUse {
  return indexedOpValue(analysis.conditionUses, instructionIndex, opIndex) ?? "localCondition";
}

export function jitInstructionMayFault(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number
): boolean {
  return (analysis.preInstructionMemoryFaults.get(instructionIndex)?.size ?? 0) !== 0;
}

function indexJitPreInstructionMemoryFaults(block: JitIrBlock): JitPreInstructionMemoryFaultIndex {
  const memoryFaults = new Map<number, Map<number, ExitReasonValue>>();

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while indexing memory faults: ${instructionIndex}`);
    }

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while indexing memory faults: ${instructionIndex}:${opIndex}`);
      }

      const faultReason = jitMemoryFaultReason(op, instruction.operands);

      if (faultReason !== undefined) {
        setIndexedOpValue(memoryFaults, instructionIndex, opIndex, faultReason);
      }
    }
  }

  return memoryFaults;
}

function indexJitPostInstructionExits(block: JitIrBlock): JitPostInstructionExitIndex {
  const postInstructionExits = new Map<number, Map<number, readonly ExitReasonValue[]>>();

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while indexing post-instruction exits: ${instructionIndex}`);
    }

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while indexing post-instruction exits: ${instructionIndex}:${opIndex}`);
      }

      const exitReasons = jitPostInstructionExitReasons(op, instruction);

      if (exitReasons.length !== 0) {
        setIndexedOpValue(postInstructionExits, instructionIndex, opIndex, exitReasons);
      }
    }
  }

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
