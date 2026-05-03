import {
  flagProducerConditionInputNames,
  flagProducerConditionKind
} from "#x86/ir/model/flag-conditions.js";
import type { IrOp, ValueRef } from "#x86/ir/model/types.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import type {
  JitFlagInput,
  JitFlagSource
} from "#backends/wasm/jit/optimization/flags/sources.js";
import {
  type JitFlagAnalysis,
  type JitFlagRead,
  type JitFlagOwnerMask
} from "#backends/wasm/jit/optimization/flags/analysis.js";
import { jitValueReadRegs } from "#backends/wasm/jit/optimization/ir/values.js";
import {
  emitJitValueRef,
  type JitInstructionRewrite
} from "#backends/wasm/jit/optimization/ir/rewrite.js";
import {
  jitIrLocation,
  requiredJitIrInstruction,
  type JitIrLocation
} from "#backends/wasm/jit/optimization/ir/walk.js";
import {
  findJitRegWritebackBetween,
  jitRegClobberedBetween
} from "#backends/wasm/jit/optimization/ir/ranges.js";

type PlannedConditionInput = Readonly<{
  input: JitFlagInput;
  validAfter: JitIrLocation;
}>;

export type JitDirectFlagCondition = Readonly<{
  read: JitFlagRead;
  source: JitFlagSource;
  inputs: Readonly<Record<string, JitFlagInput>>;
}>;

export type JitDirectFlagConditionIndex = ReadonlyMap<
  number,
  ReadonlyMap<number, JitDirectFlagCondition>
>;

export function indexDirectFlagConditions(
  block: JitIrBlock,
  analysis: JitFlagAnalysis
): JitDirectFlagConditionIndex {
  const byLocation = new Map<number, Map<number, JitDirectFlagCondition>>();

  for (const read of analysis.reads) {
    const directCondition = directFlagCondition(block, read);

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

export function emitDirectFlagCondition(
  rewrite: JitInstructionRewrite,
  op: Extract<IrOp, { op: "aluFlags.condition" }>,
  condition: JitDirectFlagCondition
): void {
  const inputs: Record<string, ValueRef> = {};

  for (const inputName of Object.keys(condition.inputs)) {
    const input = condition.inputs[inputName];

    if (input?.kind !== "value") {
      throw new Error(`missing modeled flag condition input '${inputName}' for ${condition.source.producer}/${op.cc}`);
    }

    inputs[inputName] = emitJitValueRef(rewrite, input.value);
  }

  rewrite.ops.push({
    op: "jit.flagCondition",
    dst: op.dst,
    cc: op.cc,
    producer: condition.source.producer,
    writtenMask: condition.source.writtenMask,
    undefMask: condition.source.undefMask,
    inputs
  });
}

function directFlagCondition(
  block: JitIrBlock,
  read: JitFlagRead
): JitDirectFlagCondition | undefined {
  if (read.reason !== "condition" || read.cc === undefined || read.conditionUse === undefined) {
    return undefined;
  }

  const source = singleConditionSource(read.owners);

  if (source === undefined) {
    return undefined;
  }

  const kind = flagProducerConditionKind({ producer: source.producer, cc: read.cc });

  if (kind === undefined) {
    return undefined;
  }

  const inputs = directConditionInputs(block, source, read);

  if (inputs === undefined) {
    return undefined;
  }

  return { read, source, inputs };
}

function directConditionInputs(
  block: JitIrBlock,
  source: JitFlagSource,
  read: JitFlagRead
): Readonly<Record<string, JitFlagInput>> | undefined {
  const sourceInputs = plannedSourceInputs(source, read);

  if (sourceInputs === undefined) {
    return undefined;
  }

  if (plannedInputsSafe(block, sourceInputs, read)) {
    return plannedInputValues(sourceInputs);
  }

  if (!canUseResultInputForCondition(source, read)) {
    return undefined;
  }

  const resultInput = plannedResultWritebackInput(block, source, read);

  if (resultInput === undefined) {
    return undefined;
  }

  const resultInputs = { result: resultInput };

  return plannedInputsSafe(block, resultInputs, read)
    ? plannedInputValues(resultInputs)
    : undefined;
}

function singleConditionSource(owners: readonly JitFlagOwnerMask[]): JitFlagSource | undefined {
  let source: JitFlagSource | undefined;

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

function plannedSourceInputs(
  source: JitFlagSource,
  read: JitFlagRead
): Readonly<Record<string, PlannedConditionInput>> | undefined {
  if (read.cc === undefined) {
    return undefined;
  }

  const inputs: Record<string, PlannedConditionInput> = {};
  const validAfter = sourceLocation(source);

  for (const inputName of flagProducerConditionInputNames({ producer: source.producer, cc: read.cc })) {
    const input = conditionInput(source, inputName);

    if (input?.kind !== "value") {
      return undefined;
    }

    inputs[inputName] = { input, validAfter };
  }

  return inputs;
}

function plannedResultWritebackInput(
  block: JitIrBlock,
  source: JitFlagSource,
  read: JitFlagRead
): PlannedConditionInput | undefined {
  const writeback = findResultWritebackReg(block, source, read);

  if (writeback === undefined) {
    return undefined;
  }

  return {
    input: { kind: "value", value: { kind: "reg", reg: writeback.reg } },
    validAfter: writeback.location
  };
}

function plannedInputsSafe(
  block: JitIrBlock,
  inputs: Readonly<Record<string, PlannedConditionInput>>,
  read: JitFlagRead
): boolean {
  for (const { input, validAfter } of Object.values(inputs)) {
    if (input.kind !== "value") {
      return false;
    }

    for (const reg of jitValueReadRegs(input.value)) {
      if (jitRegClobberedBetween(block, reg, validAfter, readLocation(read))) {
        return false;
      }
    }
  }

  return true;
}

function plannedInputValues(
  inputs: Readonly<Record<string, PlannedConditionInput>>
): Readonly<Record<string, JitFlagInput>> {
  return Object.fromEntries(
    Object.entries(inputs).map(([name, input]) => [name, input.input])
  );
}

function findResultWritebackReg(block: JitIrBlock, source: JitFlagSource, read: JitFlagRead) {
  const resultId = sourceResultVarId(block, source);

  if (resultId === undefined) {
    return undefined;
  }

  return findJitRegWritebackBetween(
    block,
    { kind: "var", id: resultId },
    sourceLocation(source),
    readLocation(read)
  );
}

function sourceResultVarId(block: JitIrBlock, source: JitFlagSource): number | undefined {
  const instruction = requiredJitIrInstruction(block, source.instructionIndex);
  const op = instruction.ir[source.opIndex];

  if (op?.op !== "flags.set") {
    throw new Error(`missing flags.set for flag source: ${source.instructionIndex}:${source.opIndex}`);
  }

  const result = op.inputs.result;

  return result?.kind === "var" ? result.id : undefined;
}

function sourceLocation(source: JitFlagSource): JitIrLocation {
  return jitIrLocation(source.instructionIndex, source.opIndex);
}

function canUseResultInputForCondition(
  source: JitFlagSource,
  read: JitFlagRead
): boolean {
  if (read.cc === undefined || conditionInput(source, "result")?.kind !== "value") {
    return false;
  }

  return flagProducerConditionKind({
    producer: source.producer,
    cc: read.cc,
    inputs: { result: { kind: "const32", value: 0 } }
  }) !== undefined;
}

function readLocation(read: JitFlagRead): JitIrLocation {
  return jitIrLocation(read.instructionIndex, read.opIndex);
}

function conditionInput(source: JitFlagSource, inputName: string): JitFlagInput | undefined {
  return source.inputs[inputName];
}
