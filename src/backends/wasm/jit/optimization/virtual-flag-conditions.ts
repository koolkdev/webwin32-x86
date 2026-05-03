import {
  flagProducerConditionInputNames,
  flagProducerConditionKind
} from "#x86/ir/model/flag-conditions.js";
import type { IrOp, ValueRef } from "#x86/ir/model/types.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import {
  type JitVirtualFlagAnalysis,
  type JitVirtualFlagInput,
  type JitVirtualFlagRead,
  type JitVirtualFlagOwnerMask,
  type JitVirtualFlagSource
} from "./virtual-flag-analysis.js";
import {
  emitJitVirtualValue,
  type JitVirtualRewrite
} from "./virtual-rewrite.js";

export type JitDirectVirtualFlagCondition = Readonly<{
  read: JitVirtualFlagRead;
  source: JitVirtualFlagSource;
}>;

export type JitDirectVirtualFlagConditionIndex = ReadonlyMap<
  number,
  ReadonlyMap<number, JitDirectVirtualFlagCondition>
>;

export function indexDirectVirtualFlagConditions(
  block: JitIrBlock,
  analysis: JitVirtualFlagAnalysis
): JitDirectVirtualFlagConditionIndex {
  const byLocation = new Map<number, Map<number, JitDirectVirtualFlagCondition>>();

  for (const read of analysis.reads) {
    const directCondition = directVirtualFlagCondition(block, analysis, read);

    if (directCondition === undefined) {
      continue;
    }

    let instructionConditions = byLocation.get(read.instructionIndex);

    if (instructionConditions === undefined) {
      instructionConditions = new Map();
      byLocation.set(read.instructionIndex, instructionConditions);
    }

    instructionConditions.set(read.opIndex, directCondition);
  }

  return byLocation;
}

export function emitDirectVirtualFlagCondition(
  rewrite: JitVirtualRewrite,
  op: Extract<IrOp, { op: "aluFlags.condition" }>,
  source: JitVirtualFlagSource
): void {
  const inputs: Record<string, ValueRef> = {};

  for (const inputName of flagProducerConditionInputNames({ producer: source.producer, cc: op.cc })) {
    const input = conditionInput(source, inputName);

    if (input?.kind !== "value") {
      throw new Error(`missing modeled virtual flag condition input '${inputName}' for ${source.producer}/${op.cc}`);
    }

    inputs[inputName] = emitJitVirtualValue(rewrite, input.value);
  }

  rewrite.ops.push({
    op: "flagProducer.condition",
    dst: op.dst,
    cc: op.cc,
    producer: source.producer,
    writtenMask: source.writtenMask,
    undefMask: source.undefMask,
    inputs
  });
}

function directVirtualFlagCondition(
  block: JitIrBlock,
  analysis: JitVirtualFlagAnalysis,
  read: JitVirtualFlagRead
): JitDirectVirtualFlagCondition | undefined {
  if (read.reason !== "condition" || read.cc === undefined) {
    return undefined;
  }

  if (conditionReadFeedsConditionalJump(block, read)) {
    return undefined;
  }

  const source = singleConditionSource(read.owners);

  if (source === undefined) {
    return undefined;
  }

  if (flagProducerConditionKind({ producer: source.producer, cc: read.cc }) === undefined) {
    return undefined;
  }

  if (!hasModeledConditionInputs(source, read)) {
    return undefined;
  }

  if (sourceClobberedBeforeRead(analysis, source, read)) {
    return undefined;
  }

  return { read, source };
}

function conditionReadFeedsConditionalJump(block: JitIrBlock, read: JitVirtualFlagRead): boolean {
  const instruction = block.instructions[read.instructionIndex];

  if (instruction === undefined) {
    throw new Error(`missing JIT instruction while checking virtual flag condition read: ${read.instructionIndex}`);
  }

  const op = instruction.ir[read.opIndex];

  if (op?.op !== "aluFlags.condition") {
    throw new Error(`missing aluFlags.condition for virtual flag condition read: ${read.instructionIndex}:${read.opIndex}`);
  }

  return instruction.ir.some((entry) =>
    entry.op === "conditionalJump" &&
    entry.condition.kind === "var" &&
    entry.condition.id === op.dst.id
  );
}

function singleConditionSource(owners: readonly JitVirtualFlagOwnerMask[]): JitVirtualFlagSource | undefined {
  let source: JitVirtualFlagSource | undefined;

  for (const { owner } of owners) {
    if (owner.kind !== "producer") {
      return undefined;
    }

    if (source === undefined) {
      source = owner.source;
    } else if (source !== owner.source) {
      return undefined;
    }
  }

  return source;
}

function hasModeledConditionInputs(source: JitVirtualFlagSource, read: JitVirtualFlagRead): boolean {
  if (read.cc === undefined) {
    return false;
  }

  for (const inputName of flagProducerConditionInputNames({ producer: source.producer, cc: read.cc })) {
    if (conditionInput(source, inputName)?.kind !== "value") {
      return false;
    }
  }

  return true;
}

function sourceClobberedBeforeRead(
  analysis: JitVirtualFlagAnalysis,
  source: JitVirtualFlagSource,
  read: JitVirtualFlagRead
): boolean {
  return analysis.sourceClobbers.some((clobber) =>
    locationBefore(clobber, read) &&
    clobber.owners.some(({ owner }) => owner.kind === "producer" && owner.source === source)
  );
}

function locationBefore(
  a: Readonly<{ instructionIndex: number; opIndex: number }>,
  b: Readonly<{ instructionIndex: number; opIndex: number }>
): boolean {
  return a.instructionIndex < b.instructionIndex ||
    (a.instructionIndex === b.instructionIndex && a.opIndex < b.opIndex);
}

function conditionInput(source: JitVirtualFlagSource, inputName: string): JitVirtualFlagInput | undefined {
  return source.inputs[inputName];
}
