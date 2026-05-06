import type {
  IrExprBlock,
  IrExprOp,
  IrStorageExpr,
  IrValueExpr
} from "#backends/wasm/codegen/expressions.js";
import type { JitOperandBinding } from "#backends/wasm/jit/ir/operand-bindings.js";
import {
  jitValueCost,
  jitValueForEffectiveAddress,
  jitValueForStorage,
  jitValuesEqual,
  type JitValue
} from "#backends/wasm/jit/ir/values.js";
import type { ValueRef } from "#x86/ir/model/types.js";
import type { OperandWidth, Reg32 } from "#x86/isa/types.js";
import { jitInstructionWrittenReg } from "./operand-analysis.js";

export type JitValueUseCount = Readonly<{
  value: JitValue;
  useCount: number;
}>;

export type JitExpressionValueCachePlan = Readonly<{
  operands: readonly JitOperandBinding[];
  expressionValues: ReadonlyMap<IrValueExpr, JitValue>;
  selectedValuesByEpoch: readonly (readonly JitValueUseCount[])[];
  selectedUseCounts: readonly JitValueUseCount[];
}>;

export type JitExpressionValueCacheInstruction = Readonly<{
  operands: readonly JitOperandBinding[];
}>;

type JitValueUse = Readonly<{
  value: JitValue;
  children: readonly JitValueUse[];
}>;

type FlatJitValueUse = Readonly<{
  value: JitValue;
  ancestors: readonly JitValue[];
}>;

const localTeeCost = 1;
const localSetCost = 1;
const localGetCost = 1;

export function planJitExpressionValueCache(
  instruction: JitExpressionValueCacheInstruction,
  expressionBlock: IrExprBlock
): JitExpressionValueCachePlan | undefined {
  const expressionJitValues = new Map<IrValueExpr, JitValue>();
  const epochUses = expressionValueUseEpochs(instruction, expressionBlock, expressionJitValues);
  const selectedValuesByEpoch = epochUses.map(selectEpochValues);
  const selectedUseCounts = mergeSelectedUseCounts(selectedValuesByEpoch);

  return selectedUseCounts.length === 0
    ? undefined
    : {
        operands: instruction.operands,
        expressionValues: expressionJitValues,
        selectedValuesByEpoch,
        selectedUseCounts
      };
}

export function shouldCacheValue(value: JitValue, useCount: number): boolean {
  const inlineCost = jitValueCost(value);

  if (useCount <= 1 || inlineCost <= 1) {
    return false;
  }

  const repeatedInlineCost = inlineCost * useCount;
  const cachedStackUseCost = inlineCost + localTeeCost + localGetCost * (useCount - 1);
  const materializedCost = inlineCost + localSetCost + localGetCost * useCount;

  return repeatedInlineCost > Math.min(cachedStackUseCost, materializedCost);
}

function expressionValueUseEpochs(
  instruction: JitExpressionValueCacheInstruction,
  block: IrExprBlock,
  expressionJitValues: Map<IrValueExpr, JitValue>
): readonly (readonly JitValueUse[])[] {
  const epochs: JitValueUse[][] = [];
  let currentEpoch: JitValueUse[] = [];

  for (const op of block) {
    currentEpoch.push(...valueUsesForOp(instruction, op, expressionJitValues));

    if (opWriteReg(instruction, op) !== undefined) {
      epochs.push(currentEpoch);
      currentEpoch = [];
    }
  }

  epochs.push(currentEpoch);
  return epochs;
}

function valueUsesForOp(
  instruction: JitExpressionValueCacheInstruction,
  op: IrExprOp,
  expressionJitValues: Map<IrValueExpr, JitValue>
): readonly JitValueUse[] {
  switch (op.op) {
    case "let32":
      return [];
    case "set":
      return [
        ...valueUsesForStorage(instruction, op.target, expressionJitValues),
        ...valueUsesForValue(instruction, op.value, expressionJitValues)
      ];
    case "set.if":
      return [
        ...valueUsesForValue(instruction, op.condition, expressionJitValues),
        ...valueUsesForValue(instruction, op.value, expressionJitValues)
      ];
    case "flags.set":
      return Object.values(op.inputs).flatMap((value) =>
        valueUsesForValueRef(value, expressionJitValues)
      );
    case "jump":
      return valueUsesForValue(instruction, op.target, expressionJitValues);
    case "conditionalJump":
      return [
        ...valueUsesForValue(instruction, op.condition, expressionJitValues),
        ...valueUsesForValue(instruction, op.taken, expressionJitValues),
        ...valueUsesForValue(instruction, op.notTaken, expressionJitValues)
      ];
    case "hostTrap":
      return valueUsesForValue(instruction, op.vector, expressionJitValues);
    case "flags.materialize":
    case "flags.boundary":
    case "next":
      return [];
  }
}

function valueUsesForStorage(
  instruction: JitExpressionValueCacheInstruction,
  storage: IrStorageExpr,
  expressionJitValues: Map<IrValueExpr, JitValue>
): readonly JitValueUse[] {
  return storage.kind === "mem"
    ? valueUsesForValue(instruction, storage.address, expressionJitValues)
    : [];
}

function valueUsesForValue(
  instruction: JitExpressionValueCacheInstruction,
  value: IrValueExpr,
  expressionJitValues: Map<IrValueExpr, JitValue>
): readonly JitValueUse[] {
  const children = childValueUsesForValue(instruction, value, expressionJitValues);
  const jitValue = jitValueForExpression(instruction, value, expressionJitValues);

  return jitValue === undefined
    ? children
    : [{ value: jitValue, children }];
}

function childValueUsesForValue(
  instruction: JitExpressionValueCacheInstruction,
  value: IrValueExpr,
  expressionJitValues: Map<IrValueExpr, JitValue>
): readonly JitValueUse[] {
  switch (value.kind) {
    case "source":
      return valueUsesForStorage(instruction, value.source, expressionJitValues);
    case "value.binary":
      return [
        ...valueUsesForValue(instruction, value.a, expressionJitValues),
        ...valueUsesForValue(instruction, value.b, expressionJitValues)
      ];
    case "value.unary":
      return valueUsesForValue(instruction, value.value, expressionJitValues);
    case "flagProducer.condition":
      return Object.values(value.inputs).flatMap((input) =>
        valueUsesForValueRef(input, expressionJitValues)
      );
    case "var":
    case "const":
    case "nextEip":
    case "address":
    case "aluFlags.condition":
      return [];
  }
}

function valueUsesForValueRef(
  value: ValueRef,
  expressionJitValues: Map<IrValueExpr, JitValue>
): readonly JitValueUse[] {
  switch (value.kind) {
    case "const": {
      const jitValue = { kind: "const", type: value.type, value: value.value } as const satisfies JitValue;

      expressionJitValues.set(value, jitValue);
      return [{ value: jitValue, children: [] }];
    }
    case "var":
      return [];
    case "nextEip":
      return [];
  }
}

function selectEpochValues(uses: readonly JitValueUse[]): readonly JitValueUseCount[] {
  const flatUses = flattenUses(uses);
  const candidateValues = [...uniqueValues(flatUses.map((use) => use.value))]
    .sort((a, b) => jitValueCost(b) - jitValueCost(a));
  const selected: JitValueUseCount[] = [];

  for (const value of candidateValues) {
    const usableUseCount = flatUses.filter((use) =>
      jitValuesEqual(use.value, value) && !hasSelectedAncestor(use, selected)
    ).length;

    if (shouldCacheValue(value, usableUseCount)) {
      selected.push({ value, useCount: usableUseCount });
    }
  }

  return selected;
}

function flattenUses(uses: readonly JitValueUse[]): readonly FlatJitValueUse[] {
  return uses.flatMap((use) => flattenUse(use));
}

function flattenUse(use: JitValueUse, ancestors: readonly JitValue[] = []): readonly FlatJitValueUse[] {
  const current = { value: use.value, ancestors };
  const childAncestors = [...ancestors, use.value];

  return [
    current,
    ...use.children.flatMap((child) => flattenUse(child, childAncestors))
  ];
}

function hasSelectedAncestor(
  use: FlatJitValueUse,
  selected: readonly JitValueUseCount[]
): boolean {
  return use.ancestors.some((ancestor) =>
    selected.some((entry) => jitValuesEqual(entry.value, ancestor))
  );
}

function uniqueValues(values: readonly JitValue[]): readonly JitValue[] {
  const unique: JitValue[] = [];

  for (const value of values) {
    if (!unique.some((entry) => jitValuesEqual(entry, value))) {
      unique.push(value);
    }
  }

  return unique;
}

function mergeSelectedUseCounts(
  selectedByEpoch: readonly (readonly JitValueUseCount[])[]
): readonly JitValueUseCount[] {
  const merged: JitValueUseCount[] = [];

  for (const selected of selectedByEpoch) {
    for (const entry of selected) {
      const existingIndex = merged.findIndex((candidate) =>
        jitValuesEqual(candidate.value, entry.value)
      );

      if (existingIndex === -1) {
        merged.push(entry);
      } else {
        const existing = merged[existingIndex]!;

        merged[existingIndex] = {
          value: existing.value,
          useCount: existing.useCount + entry.useCount
        };
      }
    }
  }

  return merged;
}

function jitValueForExpression(
  instruction: JitExpressionValueCacheInstruction,
  value: IrValueExpr,
  expressionJitValues?: Map<IrValueExpr, JitValue>
): JitValue | undefined {
  const jitValue = jitValueForExpressionUntracked(instruction, value, expressionJitValues);

  if (jitValue !== undefined) {
    expressionJitValues?.set(value, jitValue);
  }

  return jitValue;
}

function jitValueForExpressionUntracked(
  instruction: JitExpressionValueCacheInstruction,
  value: IrValueExpr,
  expressionJitValues?: Map<IrValueExpr, JitValue>
): JitValue | undefined {
  switch (value.kind) {
    case "var":
      return undefined;
    case "const":
      return { kind: "const", type: value.type, value: value.value };
    case "source":
      return jitValueForStorageExpr(instruction, value.source, value.accessWidth, value.signed === true);
    case "address":
      return jitValueForEffectiveAddress(value.operand, instruction.operands, new Map());
    case "value.binary": {
      const a = jitValueForExpression(instruction, value.a, expressionJitValues);
      const b = jitValueForExpression(instruction, value.b, expressionJitValues);

      return a === undefined || b === undefined
        ? undefined
        : { kind: value.kind, type: value.type, operator: value.operator, a, b };
    }
    case "value.unary": {
      const inner = jitValueForExpression(instruction, value.value, expressionJitValues);

      return inner === undefined
        ? undefined
        : { kind: value.kind, type: value.type, operator: value.operator, value: inner };
    }
    case "nextEip":
    case "aluFlags.condition":
    case "flagProducer.condition":
      return undefined;
  }
}

function jitValueForStorageExpr(
  instruction: JitExpressionValueCacheInstruction,
  storage: IrStorageExpr,
  accessWidth: OperandWidth,
  signed: boolean
): JitValue | undefined {
  switch (storage.kind) {
    case "reg":
    case "operand":
      return jitValueForStorage(storage, instruction.operands, new Map(), accessWidth, signed);
    case "mem":
      return undefined;
  }
}

function opWriteReg(
  instruction: JitExpressionValueCacheInstruction,
  op: IrExprOp
): Reg32 | undefined {
  switch (op.op) {
    case "set":
    case "set.if":
      return jitInstructionWrittenReg(instruction, op.target, op.accessWidth);
    default:
      return undefined;
  }
}
