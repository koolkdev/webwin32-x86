import type { ValueRef } from "#x86/ir/model/types.js";
import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import {
  analyzeJitConditionUses,
  indexJitExitConditionValues,
  indexJitLocalConditionValues,
  type JitConditionUse
} from "./condition-uses.js";
import { walkJitIrBlockOps } from "./ir-walk.js";
import { jitMemoryFaultReason, jitPostInstructionExitReasons } from "./op-effects.js";
import { setJitOpIndexValue, type JitOpIndex } from "./op-index.js";

export type JitOptimizationBoundary =
  | Readonly<{ kind: "preInstructionExit"; exitReason: ExitReasonValue }>
  | Readonly<{ kind: "postInstructionExit"; exitReasons: readonly ExitReasonValue[] }>
  | Readonly<{ kind: "conditionRead"; conditionUse: JitConditionUse }>
  | Readonly<{ kind: "localCondition"; values: readonly ValueRef[] }>
  | Readonly<{ kind: "exitCondition"; values: readonly ValueRef[] }>;

export type JitOptimizationBoundaryIndex = JitOpIndex<readonly JitOptimizationBoundary[]>;

type JitOptimizationBoundarySources = Readonly<{
  preInstructionExits: JitOpIndex<ExitReasonValue>;
  postInstructionExits: JitOpIndex<readonly ExitReasonValue[]>;
  localConditionValues: JitOpIndex<readonly ValueRef[]>;
  exitConditionValues: JitOpIndex<readonly ValueRef[]>;
  conditionUses: JitOpIndex<JitConditionUse>;
}>;

export function indexJitOptimizationBoundaries(
  block: JitIrBlock
): JitOptimizationBoundaryIndex {
  const localConditionValues = indexJitLocalConditionValues(block);
  const exitConditionValues = indexJitExitConditionValues(block);

  return indexJitOptimizationBoundariesFromSources({
    preInstructionExits: indexJitPreInstructionExits(block),
    postInstructionExits: indexJitPostInstructionExits(block),
    localConditionValues,
    exitConditionValues,
    conditionUses: analyzeJitConditionUses(block, localConditionValues, exitConditionValues)
  });
}

function indexJitOptimizationBoundariesFromSources(
  analysis: JitOptimizationBoundarySources
): JitOptimizationBoundaryIndex {
  const boundaries = new Map<number, Map<number, readonly JitOptimizationBoundary[]>>();

  addIndexedBoundaries(analysis.preInstructionExits, boundaries, (exitReason) => ({
    kind: "preInstructionExit",
    exitReason
  }));
  addIndexedBoundaries(analysis.postInstructionExits, boundaries, (exitReasons) => ({
    kind: "postInstructionExit",
    exitReasons
  }));
  addConditionValueBoundaries(analysis.localConditionValues, boundaries, "localCondition");
  addConditionValueBoundaries(analysis.exitConditionValues, boundaries, "exitCondition");
  addConditionReadBoundaries(analysis.conditionUses, boundaries);

  return boundaries;
}

function indexJitPreInstructionExits(block: JitIrBlock): JitOpIndex<ExitReasonValue> {
  const preInstructionExits = new Map<number, Map<number, ExitReasonValue>>();

  walkJitIrBlockOps(block, (instruction, op, location) => {
    const faultReason = jitMemoryFaultReason(op, instruction.operands);

    if (faultReason !== undefined) {
      setJitOpIndexValue(preInstructionExits, location.instructionIndex, location.opIndex, faultReason);
    }
  }, "indexing pre-instruction exits");

  return preInstructionExits;
}

function indexJitPostInstructionExits(block: JitIrBlock): JitOpIndex<readonly ExitReasonValue[]> {
  const postInstructionExits = new Map<number, Map<number, readonly ExitReasonValue[]>>();

  walkJitIrBlockOps(block, (instruction, op, location) => {
    const exitReasons = jitPostInstructionExitReasons(op, instruction);

    if (exitReasons.length !== 0) {
      setJitOpIndexValue(postInstructionExits, location.instructionIndex, location.opIndex, exitReasons);
    }
  }, "indexing post-instruction exits");

  return postInstructionExits;
}

export function jitBoundariesAt(
  boundaries: JitOptimizationBoundaryIndex,
  instructionIndex: number,
  opIndex: number
): readonly JitOptimizationBoundary[] {
  return boundaries.get(instructionIndex)?.get(opIndex) ?? [];
}

export function jitBoundaryAt<K extends JitOptimizationBoundary["kind"]>(
  boundaries: JitOptimizationBoundaryIndex,
  instructionIndex: number,
  opIndex: number,
  kind: K
): Extract<JitOptimizationBoundary, { kind: K }> | undefined {
  return jitBoundariesAt(boundaries, instructionIndex, opIndex).find((entry): entry is Extract<JitOptimizationBoundary, { kind: K }> =>
    entry.kind === kind
  );
}

export function jitConditionValuesAt(
  boundaries: JitOptimizationBoundaryIndex,
  instructionIndex: number,
  opIndex: number,
  kind: "localCondition" | "exitCondition"
): readonly ValueRef[] {
  return jitBoundaryAt(boundaries, instructionIndex, opIndex, kind)?.values ?? [];
}

function addConditionValueBoundaries(
  valuesByLocation: JitOpIndex<readonly ValueRef[]>,
  boundaries: Map<number, Map<number, readonly JitOptimizationBoundary[]>>,
  kind: "localCondition" | "exitCondition"
): void {
  for (const [instructionIndex, valuesByOp] of valuesByLocation) {
    for (const [opIndex, values] of valuesByOp) {
      addBoundary(boundaries, instructionIndex, opIndex, { kind, values });
    }
  }
}

function addConditionReadBoundaries(
  conditionUses: JitOpIndex<JitConditionUse>,
  boundaries: Map<number, Map<number, readonly JitOptimizationBoundary[]>>
): void {
  for (const [instructionIndex, usesByOp] of conditionUses) {
    for (const [opIndex, conditionUse] of usesByOp) {
      addBoundary(boundaries, instructionIndex, opIndex, { kind: "conditionRead", conditionUse });
    }
  }
}

function addIndexedBoundaries<T>(
  index: JitOpIndex<T>,
  boundaries: Map<number, Map<number, readonly JitOptimizationBoundary[]>>,
  createBoundary: (value: T) => JitOptimizationBoundary
): void {
  for (const [instructionIndex, valuesByOp] of index) {
    for (const [opIndex, value] of valuesByOp) {
      addBoundary(boundaries, instructionIndex, opIndex, createBoundary(value));
    }
  }
}

function addBoundary(
  boundaries: Map<number, Map<number, readonly JitOptimizationBoundary[]>>,
  instructionIndex: number,
  opIndex: number,
  boundary: JitOptimizationBoundary
): void {
  let instructionBoundaries = boundaries.get(instructionIndex);

  if (instructionBoundaries === undefined) {
    instructionBoundaries = new Map();
    boundaries.set(instructionIndex, instructionBoundaries);
  }

  instructionBoundaries.set(opIndex, [
    ...(instructionBoundaries.get(opIndex) ?? []),
    boundary
  ]);
}
