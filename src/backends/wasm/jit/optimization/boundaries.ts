import type { ValueRef } from "#x86/ir/model/types.js";
import type { ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitOptimizationAnalysis, JitOpIndex } from "./analysis.js";
import type { JitConditionUse } from "./condition-uses.js";

export type JitOptimizationBoundary =
  | Readonly<{ kind: "preInstructionExit"; exitReason: ExitReasonValue }>
  | Readonly<{ kind: "postInstructionExit"; exitReasons: readonly ExitReasonValue[] }>
  | Readonly<{ kind: "conditionRead"; conditionUse: JitConditionUse }>
  | Readonly<{ kind: "localCondition"; values: readonly ValueRef[] }>
  | Readonly<{ kind: "exitCondition"; values: readonly ValueRef[] }>;

export type JitOptimizationBoundaryIndex = JitOpIndex<readonly JitOptimizationBoundary[]>;

export function indexJitOptimizationBoundaries(
  analysis: Pick<
    JitOptimizationAnalysis,
    "preInstructionExits" | "postInstructionExits" | "localConditionValues" | "exitConditionValues" | "conditionUses"
  >
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
