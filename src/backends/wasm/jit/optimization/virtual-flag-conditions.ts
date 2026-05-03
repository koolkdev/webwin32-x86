import {
  flagProducerConditionInputNames,
  flagProducerConditionKind
} from "#x86/ir/model/flag-conditions.js";
import type { Reg32 } from "#x86/isa/types.js";
import type { IrOp, ValueRef } from "#x86/ir/model/types.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import {
  type JitVirtualFlagAnalysis,
  type JitVirtualFlagInput,
  type JitVirtualFlagRead,
  type JitVirtualFlagOwnerMask,
  type JitVirtualFlagSource
} from "./virtual-flag-analysis.js";
import { jitStorageReg, jitVirtualValueReadRegs } from "./virtual-values.js";
import {
  emitJitVirtualValue,
  type JitVirtualRewrite
} from "./virtual-rewrite.js";

type IrLocation = Readonly<{
  instructionIndex: number;
  opIndex: number;
}>;

type PlannedConditionInput = Readonly<{
  input: JitVirtualFlagInput;
  validAfter: IrLocation;
}>;

export type JitDirectVirtualFlagCondition = Readonly<{
  read: JitVirtualFlagRead;
  source: JitVirtualFlagSource;
  inputs: Readonly<Record<string, JitVirtualFlagInput>>;
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
    const directCondition = directVirtualFlagCondition(block, read);

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
  condition: JitDirectVirtualFlagCondition
): void {
  const inputs: Record<string, ValueRef> = {};

  for (const inputName of Object.keys(condition.inputs)) {
    const input = condition.inputs[inputName];

    if (input?.kind !== "value") {
      throw new Error(`missing modeled virtual flag condition input '${inputName}' for ${condition.source.producer}/${op.cc}`);
    }

    inputs[inputName] = emitJitVirtualValue(rewrite, input.value);
  }

  rewrite.ops.push({
    op: "flagProducer.condition",
    dst: op.dst,
    cc: op.cc,
    producer: condition.source.producer,
    writtenMask: condition.source.writtenMask,
    undefMask: condition.source.undefMask,
    inputs
  });
}

function directVirtualFlagCondition(
  block: JitIrBlock,
  read: JitVirtualFlagRead
): JitDirectVirtualFlagCondition | undefined {
  if (read.reason !== "condition" || read.cc === undefined || read.conditionUse !== "localCondition") {
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
  source: JitVirtualFlagSource,
  read: JitVirtualFlagRead
): Readonly<Record<string, JitVirtualFlagInput>> | undefined {
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

function plannedSourceInputs(
  source: JitVirtualFlagSource,
  read: JitVirtualFlagRead
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
  source: JitVirtualFlagSource,
  read: JitVirtualFlagRead
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
  read: JitVirtualFlagRead
): boolean {
  for (const { input, validAfter } of Object.values(inputs)) {
    if (input.kind !== "value") {
      return false;
    }

    for (const reg of jitVirtualValueReadRegs(input.value)) {
      if (regClobberedBetween(block, reg, validAfter, read)) {
        return false;
      }
    }
  }

  return true;
}

function plannedInputValues(
  inputs: Readonly<Record<string, PlannedConditionInput>>
): Readonly<Record<string, JitVirtualFlagInput>> {
  return Object.fromEntries(
    Object.entries(inputs).map(([name, input]) => [name, input.input])
  );
}

function findResultWritebackReg(
  block: JitIrBlock,
  source: JitVirtualFlagSource,
  read: JitVirtualFlagRead
): Readonly<{ reg: Reg32; location: IrLocation }> | undefined {
  const resultId = sourceResultVarId(block, source);
  let resultWriteback: Readonly<{ reg: Reg32; location: IrLocation }> | undefined;

  if (resultId === undefined) {
    return undefined;
  }

  const sourceLocationValue = sourceLocation(source);

  forEachOpBetween(block, sourceLocationValue, read, (instruction, op, location) => {
    if (resultWriteback !== undefined) {
      return;
    }

    if (op.op !== "set32" || op.value.kind !== "var" || op.value.id !== resultId) {
      return;
    }

    const reg = jitStorageReg(op.target, instruction.operands);

    if (reg !== undefined) {
      resultWriteback = { reg, location };
    }
  });

  return resultWriteback;
}

function sourceResultVarId(block: JitIrBlock, source: JitVirtualFlagSource): number | undefined {
  const instruction = requiredInstruction(block, source.instructionIndex);
  const op = instruction.ir[source.opIndex];

  if (op?.op !== "flags.set") {
    throw new Error(`missing flags.set for virtual flag source: ${source.instructionIndex}:${source.opIndex}`);
  }

  const result = op.inputs.result;

  return result?.kind === "var" ? result.id : undefined;
}

function regClobberedBetween(
  block: JitIrBlock,
  reg: Reg32,
  after: IrLocation,
  before: IrLocation
): boolean {
  let clobbered = false;

  forEachOpBetween(block, after, before, (instruction, op) => {
    if (op.op === "set32" && jitStorageReg(op.target, instruction.operands) === reg) {
      clobbered = true;
    }
  });

  return clobbered;
}

function forEachOpBetween(
  block: JitIrBlock,
  after: IrLocation,
  before: IrLocation,
  visit: (
    instruction: JitIrBlock["instructions"][number],
    op: IrOp,
    location: IrLocation
  ) => void
): void {
  if (!locationBefore(after, before)) {
    return;
  }

  for (let instructionIndex = after.instructionIndex; instructionIndex <= before.instructionIndex; instructionIndex += 1) {
    const instruction = requiredInstruction(block, instructionIndex);
    const startOpIndex = instructionIndex === after.instructionIndex ? after.opIndex + 1 : 0;
    const endOpIndex = instructionIndex === before.instructionIndex ? before.opIndex : instruction.ir.length;

    for (let opIndex = startOpIndex; opIndex < endOpIndex; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while checking virtual flag condition inputs: ${instructionIndex}:${opIndex}`);
      }

      visit(instruction, op, { instructionIndex, opIndex });
    }
  }
}

function requiredInstruction(block: JitIrBlock, instructionIndex: number): JitIrBlock["instructions"][number] {
  const instruction = block.instructions[instructionIndex];

  if (instruction === undefined) {
    throw new Error(`missing JIT instruction while checking virtual flag condition inputs: ${instructionIndex}`);
  }

  return instruction;
}

function sourceLocation(source: JitVirtualFlagSource): IrLocation {
  return {
    instructionIndex: source.instructionIndex,
    opIndex: source.opIndex
  };
}

function canUseResultInputForCondition(
  source: JitVirtualFlagSource,
  read: JitVirtualFlagRead
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
