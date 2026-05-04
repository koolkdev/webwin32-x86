import type { ConditionCode, FlagMask, FlagProducerName, IrFlagSetOp, ValueRef } from "./types.js";

export type IrFlagProducerConditionKind =
  | "eq"
  | "ne"
  | "uLt"
  | "uGe"
  | "sLt"
  | "sGe"
  | "sLe"
  | "sGt"
  | "zero"
  | "nonZero"
  | "sign"
  | "notSign"
  | "parity8"
  | "notParity8"
  | "constTrue"
  | "constFalse"
  | "zeroOrSign"
  | "nonZeroAndNotSign";

export type IrFlagProducerConditionDescriptor = Readonly<{
  cc: ConditionCode;
  producer: FlagProducerName;
  width?: IrFlagSetOp["width"];
  writtenMask: FlagMask;
  undefMask: FlagMask;
  inputs: Readonly<Record<string, ValueRef>>;
}>;

export type IrFlagProducerDescriptor = Pick<
  IrFlagSetOp,
  "producer" | "width" | "writtenMask" | "undefMask" | "inputs"
>;

export function flagProducerConditionKind(
  condition: Pick<IrFlagProducerConditionDescriptor, "cc" | "producer"> &
    Partial<Pick<IrFlagProducerConditionDescriptor, "inputs" | "width">>
): IrFlagProducerConditionKind | undefined {
  if (condition.producer === "logic") {
    switch (condition.cc) {
      case "O":
      case "B":
        return "constFalse";
      case "NO":
      case "AE":
        return "constTrue";
      case "E":
      case "BE":
        return "zero";
      case "NE":
      case "A":
        return "nonZero";
      case "S":
      case "L":
        return "sign";
      case "NS":
      case "GE":
        return "notSign";
      case "P":
        return "parity8";
      case "NP":
        return "notParity8";
      case "LE":
        return "zeroOrSign";
      case "G":
        return "nonZeroAndNotSign";
    }
  }

  if (condition.producer === "sub" && !conditionUsesOnlyResultInput(condition)) {
    switch (condition.cc) {
      case "E":
        return "eq";
      case "NE":
        return "ne";
      case "B":
        return "uLt";
      case "AE":
        return "uGe";
      case "L":
        return "sLt";
      case "GE":
        return "sGe";
      case "LE":
        return "sLe";
      case "G":
        return "sGt";
    }
  }

  if (!producerHasResultInput(condition.producer)) {
    return undefined;
  }

  switch (condition.cc) {
    case "E":
      return "zero";
    case "NE":
      return "nonZero";
    case "S":
      return "sign";
    case "NS":
      return "notSign";
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
  return flagProducerConditionKind({
    producer: descriptor.producer,
    width: descriptor.width,
    cc,
    inputs: descriptor.inputs
  }) !== undefined;
}

export function flagProducerConditionInputNames(
  condition: Pick<IrFlagProducerConditionDescriptor, "cc" | "producer"> &
    Partial<Pick<IrFlagProducerConditionDescriptor, "inputs" | "width">>
): readonly string[] {
  switch (flagProducerConditionKind(condition)) {
    case "eq":
    case "ne":
    case "uLt":
    case "uGe":
    case "sLt":
    case "sGe":
    case "sLe":
    case "sGt":
      return ["left", "right"];
    case "zero":
    case "nonZero":
    case "sign":
    case "notSign":
    case "parity8":
    case "notParity8":
    case "zeroOrSign":
    case "nonZeroAndNotSign":
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
  return producer === "add" ||
    producer === "sub" ||
    producer === "logic" ||
    producer === "inc" ||
    producer === "dec";
}

function conditionUsesOnlyResultInput(condition: Partial<Pick<IrFlagProducerConditionDescriptor, "inputs">>): boolean {
  if (condition.inputs === undefined) {
    return false;
  }

  return condition.inputs.result !== undefined &&
    condition.inputs.left === undefined &&
    condition.inputs.right === undefined;
}
