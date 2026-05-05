import {
  flagProducerConditionInputNames,
  flagProducerConditionKind
} from "#x86/ir/model/flag-conditions.js";
import type { JitIrBlock } from "#backends/wasm/jit/ir/types.js";
import type {
  JitFlagInput,
  JitFlagSource
} from "#backends/wasm/jit/optimization/analyses/flag-sources.js";
import type { JitFlagOwnerMask } from "#backends/wasm/jit/optimization/analyses/flag-owners.js";
import { jitValueMaterializationRegs } from "#backends/wasm/jit/ir/values.js";
import {
  jitIrLocation,
  requiredJitIrInstruction,
  type JitIrLocation
} from "#backends/wasm/jit/ir/walk.js";
import {
  findJitRegWritebackBetween,
  jitRegClobberedBetween
} from "#backends/wasm/jit/ir/ranges.js";
import type {
  JitReachingFlagRead,
  JitReachingFlags
} from "#backends/wasm/jit/optimization/analyses/reaching-flags.js";

type CandidateConditionInput = Readonly<{
  input: JitFlagInput;
  validAfter: JitIrLocation;
}>;

type CandidateConditionInputs = Readonly<{
  inputNames: readonly string[];
  inputs: Readonly<Record<string, CandidateConditionInput>>;
}>;

type DirectConditionInputs = Readonly<{
  inputNames: readonly string[];
  inputs: Readonly<Record<string, JitFlagInput>>;
}>;

export type JitDirectFlagCondition = Readonly<{
  read: JitReachingFlagRead;
  source: JitFlagSource;
  inputNames: readonly string[];
  inputs: Readonly<Record<string, JitFlagInput>>;
}>;

export type JitDirectFlagConditionIndex = ReadonlyMap<
  number,
  ReadonlyMap<number, JitDirectFlagCondition>
>;

export function indexDirectFlagConditions(
  block: JitIrBlock,
  analysis: JitReachingFlags
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

function directFlagCondition(
  block: JitIrBlock,
  read: JitReachingFlagRead
): JitDirectFlagCondition | undefined {
  if (read.reason !== "condition" || read.cc === undefined || read.conditionUse === undefined) {
    return undefined;
  }

  const source = singleConditionSource(read.owners);

  if (source === undefined) {
    return undefined;
  }

  const kind = flagProducerConditionKind({ producer: source.producer, width: source.width, cc: read.cc });

  if (kind === undefined) {
    return undefined;
  }

  const directInputs = directConditionInputs(block, source, read);

  if (directInputs === undefined) {
    return undefined;
  }

  return {
    read,
    source,
    inputNames: directInputs.inputNames,
    inputs: directInputs.inputs
  };
}

function directConditionInputs(
  block: JitIrBlock,
  source: JitFlagSource,
  read: JitReachingFlagRead
): DirectConditionInputs | undefined {
  const sourceInputs = sourceConditionInputs(source, read);

  if (sourceInputs === undefined) {
    return undefined;
  }

  if (candidateInputsSafe(block, sourceInputs.inputs, read)) {
    return candidateInputValues(sourceInputs);
  }

  const cc = read.cc;

  if (cc === undefined || !canUseResultInputForCondition(source, read)) {
    return undefined;
  }

  const resultInput = resultWritebackInput(block, source, read);

  if (resultInput === undefined) {
    return undefined;
  }

  const resultInputs = {
    inputNames: flagProducerConditionInputNames({
      producer: source.producer,
      width: source.width,
      cc,
      inputs: { result: { kind: "const32", value: 0 } }
    }),
    inputs: { result: resultInput }
  };

  return candidateInputsSafe(block, resultInputs.inputs, read)
    ? candidateInputValues(resultInputs)
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

function sourceConditionInputs(
  source: JitFlagSource,
  read: JitReachingFlagRead
): CandidateConditionInputs | undefined {
  if (read.cc === undefined) {
    return undefined;
  }

  const inputNames = flagProducerConditionInputNames({ producer: source.producer, width: source.width, cc: read.cc });
  const inputs: Record<string, CandidateConditionInput> = {};
  const validAfter = sourceLocation(source);

  for (const inputName of inputNames) {
    const input = conditionInput(source, inputName);

    if (input?.kind !== "value") {
      return undefined;
    }

    inputs[inputName] = { input, validAfter };
  }

  return { inputNames, inputs };
}

function resultWritebackInput(
  block: JitIrBlock,
  source: JitFlagSource,
  read: JitReachingFlagRead
): CandidateConditionInput | undefined {
  const writeback = findResultWritebackReg(block, source, read);

  if (writeback === undefined) {
    return undefined;
  }

  return {
    input: { kind: "reg", reg: writeback.reg },
    validAfter: writeback.location
  };
}

function candidateInputsSafe(
  block: JitIrBlock,
  inputs: Readonly<Record<string, CandidateConditionInput>>,
  read: JitReachingFlagRead
): boolean {
  for (const { input, validAfter } of Object.values(inputs)) {
    switch (input.kind) {
      case "value":
        for (const reg of jitValueMaterializationRegs(input.value)) {
          if (jitRegClobberedBetween(block, reg, validAfter, readLocation(read))) {
            return false;
          }
        }
        break;
      case "reg":
        if (jitRegClobberedBetween(block, input.reg, validAfter, readLocation(read))) {
          return false;
        }
        break;
      case "unmodeled":
        return false;
    }
  }

  return true;
}

function candidateInputValues(candidate: CandidateConditionInputs): DirectConditionInputs {
  return {
    inputNames: candidate.inputNames,
    inputs: Object.fromEntries(
      Object.entries(candidate.inputs).map(([name, input]) => [name, input.input])
    )
  };
}

function findResultWritebackReg(block: JitIrBlock, source: JitFlagSource, read: JitReachingFlagRead) {
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
  read: JitReachingFlagRead
): boolean {
  if (read.cc === undefined || conditionInput(source, "result")?.kind !== "value") {
    return false;
  }

  return flagProducerConditionKind({
    producer: source.producer,
    width: source.width,
    cc: read.cc,
    inputs: { result: { kind: "const32", value: 0 } }
  }) !== undefined;
}

function readLocation(read: JitReachingFlagRead): JitIrLocation {
  return jitIrLocation(read.instructionIndex, read.opIndex);
}

function conditionInput(source: JitFlagSource, inputName: string): JitFlagInput | undefined {
  return source.inputs[inputName];
}
