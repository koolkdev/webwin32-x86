import { addFlags, logicalFlags, subFlags, type FlagValues } from "../arch/x86/flags/arithmetic.js";
import type { DecodedInstruction } from "../arch/x86/instruction/types.js";
import type { RunResult } from "../core/execution/run-result.js";
import type { GuestMemory, MemoryFault } from "../core/memory/guest-memory.js";
import { type CpuState, u32 } from "../core/state/cpu-state.js";
import { type OperandWriteResult, readOperandValue, writeFlags, writeOperandValue } from "./operands.js";
import { runMutation } from "./mutation.js";

type BinaryValues =
  | Readonly<{ kind: "value"; left: number; right: number }>
  | Readonly<{ kind: "unsupported" }>
  | Readonly<{ kind: "memoryFault"; fault: MemoryFault }>;

type BinaryResult = Readonly<{
  value: number;
  flags: FlagValues;
}>;

type BinaryEvaluator = (left: number, right: number) => BinaryResult;
type AluHandler = (
  state: CpuState,
  instruction: DecodedInstruction,
  memory?: GuestMemory
) => RunResult;

export const executeAdd: AluHandler = destinationHandler(true, add);
export const executeSub: AluHandler = destinationHandler(true, sub);
export const executeXor: AluHandler = destinationHandler(false, xor);
export const executeCmp: AluHandler = flagsHandler(true, sub);
export const executeTest: AluHandler = flagsHandler(false, test);

function destinationHandler(signExtendImm8: boolean, evaluate: BinaryEvaluator): AluHandler {
  return (state, instruction, memory) =>
    runMutation(state, instruction, () =>
      applyAluToDestination(state, instruction, memory, signExtendImm8, evaluate)
    );
}

function flagsHandler(signExtendImm8: boolean, evaluate: BinaryEvaluator): AluHandler {
  return (state, instruction, memory) =>
    runMutation(state, instruction, () =>
      updateFlagsFromOperands(state, instruction, memory, signExtendImm8, evaluate)
    );
}

function applyAluToDestination(
  state: CpuState,
  instruction: DecodedInstruction,
  memory: GuestMemory | undefined,
  signExtendImm8: boolean,
  evaluate: BinaryEvaluator
): OperandWriteResult {
  const values = readBinaryValues(state, instruction, memory, signExtendImm8);

  if (values.kind !== "value") {
    return values;
  }

  const result = evaluate(values.left, values.right);
  const write = writeOperandValue(state, instruction.operands[0], result.value, { memory });

  if (write.kind !== "ok") {
    return write;
  }

  writeFlags(state, result.flags);

  return { kind: "ok" };
}

function updateFlagsFromOperands(
  state: CpuState,
  instruction: DecodedInstruction,
  memory: GuestMemory | undefined,
  signExtendImm8: boolean,
  evaluate: BinaryEvaluator
): OperandWriteResult {
  const values = readBinaryValues(state, instruction, memory, signExtendImm8);

  if (values.kind !== "value") {
    return values;
  }

  writeFlags(state, evaluate(values.left, values.right).flags);

  return { kind: "ok" };
}

function readBinaryValues(
  state: CpuState,
  instruction: DecodedInstruction,
  memory: GuestMemory | undefined,
  signExtendImm8: boolean
): BinaryValues {
  const left = readOperandValue(state, instruction.operands[0], { memory });

  if (left.kind !== "value") {
    return left;
  }

  const right = readOperandValue(state, instruction.operands[1], { memory, signExtendImm8 });

  if (right.kind !== "value") {
    return right;
  }

  return { kind: "value", left: left.value, right: right.value };
}

function add(left: number, right: number): BinaryResult {
  const value = u32(left + right);

  return { value, flags: addFlags(left, right, value) };
}

function sub(left: number, right: number): BinaryResult {
  const value = u32(left - right);

  return { value, flags: subFlags(left, right, value) };
}

function xor(left: number, right: number): BinaryResult {
  const value = u32(left ^ right);

  return { value, flags: logicalFlags(value) };
}

function test(left: number, right: number): BinaryResult {
  const value = u32(left & right);

  return { value, flags: logicalFlags(value) };
}
