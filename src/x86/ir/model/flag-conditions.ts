import type { ConditionCode, FlagMask, FlagProducerName, IrFlagSetOp, ValueRef } from "./types.js";

export type IrFlagProducerConditionKind =
  | "eq32"
  | "ne32"
  | "uLt32"
  | "uGe32"
  | "sLt32"
  | "sGe32"
  | "sLe32"
  | "sGt32"
  | "zero32"
  | "nonZero32"
  | "sign32"
  | "notSign32"
  | "parity8"
  | "notParity8"
  | "constTrue"
  | "constFalse"
  | "zeroOrSign32"
  | "nonZeroAndNotSign32";

export type IrFlagProducerConditionDescriptor = Readonly<{
  cc: ConditionCode;
  producer: FlagProducerName;
  writtenMask: FlagMask;
  undefMask: FlagMask;
  inputs: Readonly<Record<string, ValueRef>>;
}>;

export type IrFlagProducerDescriptor = Pick<
  IrFlagSetOp,
  "producer" | "writtenMask" | "undefMask" | "inputs"
>;

export function flagProducerConditionKind(
  condition: Pick<IrFlagProducerConditionDescriptor, "cc" | "producer"> & Partial<Pick<IrFlagProducerConditionDescriptor, "inputs">>
): IrFlagProducerConditionKind | undefined {
  if (condition.producer === "logic32") {
    switch (condition.cc) {
      case "O":
      case "B":
        return "constFalse";
      case "NO":
      case "AE":
        return "constTrue";
      case "E":
      case "BE":
        return "zero32";
      case "NE":
      case "A":
        return "nonZero32";
      case "S":
      case "L":
        return "sign32";
      case "NS":
      case "GE":
        return "notSign32";
      case "P":
        return "parity8";
      case "NP":
        return "notParity8";
      case "LE":
        return "zeroOrSign32";
      case "G":
        return "nonZeroAndNotSign32";
    }
  }

  if (condition.producer === "sub32" && !conditionUsesOnlyResultInput(condition)) {
    switch (condition.cc) {
      case "E":
        return "eq32";
      case "NE":
        return "ne32";
      case "B":
        return "uLt32";
      case "AE":
        return "uGe32";
      case "L":
        return "sLt32";
      case "GE":
        return "sGe32";
      case "LE":
        return "sLe32";
      case "G":
        return "sGt32";
    }
  }

  if (!producerHasResultInput(condition.producer)) {
    return undefined;
  }

  switch (condition.cc) {
    case "E":
      return "zero32";
    case "NE":
      return "nonZero32";
    case "S":
      return "sign32";
    case "NS":
      return "notSign32";
    case "P":
      return "parity8";
    case "NP":
      return "notParity8";
    default:
      return undefined;
  }
}

export function canUseFlagProducerCondition(
  descriptor: IrFlagProducerDescriptor,
  cc: ConditionCode
): boolean {
  return flagProducerConditionKind({ producer: descriptor.producer, cc, inputs: descriptor.inputs }) !== undefined;
}

export function flagProducerConditionInputNames(
  condition: Pick<IrFlagProducerConditionDescriptor, "cc" | "producer"> & Partial<Pick<IrFlagProducerConditionDescriptor, "inputs">>
): readonly string[] {
  switch (flagProducerConditionKind(condition)) {
    case "eq32":
    case "ne32":
    case "uLt32":
    case "uGe32":
    case "sLt32":
    case "sGe32":
    case "sLe32":
    case "sGt32":
      return ["left", "right"];
    case "zero32":
    case "nonZero32":
    case "sign32":
    case "notSign32":
    case "parity8":
    case "notParity8":
    case "zeroOrSign32":
    case "nonZeroAndNotSign32":
      return ["result"];
    case "constTrue":
    case "constFalse":
      return [];
    case undefined:
      throw new Error(`unsupported flag producer condition: ${condition.producer}/${condition.cc}`);
  }
}

export function requiredFlagProducerConditionInput(
  condition: IrFlagProducerConditionDescriptor,
  name: string
): ValueRef {
  const input = condition.inputs[name];

  if (input === undefined) {
    throw new Error(`missing flag producer condition input '${name}' for ${condition.producer}/${condition.cc}`);
  }

  return input;
}

function producerHasResultInput(producer: FlagProducerName): boolean {
  return producer === "add32" ||
    producer === "sub32" ||
    producer === "logic32" ||
    producer === "inc32" ||
    producer === "dec32";
}

function conditionUsesOnlyResultInput(condition: Partial<Pick<IrFlagProducerConditionDescriptor, "inputs">>): boolean {
  if (condition.inputs === undefined) {
    return false;
  }

  return condition.inputs.result !== undefined &&
    condition.inputs.left === undefined &&
    condition.inputs.right === undefined;
}
