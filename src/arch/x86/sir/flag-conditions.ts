import type { ConditionCode, SirFlagProducerConditionOp, SirFlagSetOp, ValueRef } from "./types.js";

export type SirFlagProducerConditionKind =
  | "eq32"
  | "ne32"
  | "uLt32"
  | "uGe32"
  | "sLt32"
  | "sGe32"
  | "sLe32"
  | "sGt32";

export type SirFlagProducerConditionDescriptor = Pick<
  SirFlagProducerConditionOp,
  "cc" | "producer" | "writtenMask" | "undefMask" | "inputs"
>;

export type SirFlagProducerDescriptor = Pick<
  SirFlagSetOp,
  "producer" | "writtenMask" | "undefMask" | "inputs"
>;

export function flagProducerConditionKind(
  condition: Pick<SirFlagProducerConditionOp, "cc" | "producer">
): SirFlagProducerConditionKind | undefined {
  if (condition.producer !== "sub32") {
    return undefined;
  }

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
    default:
      return undefined;
  }
}

export function canUseFlagProducerCondition(
  descriptor: SirFlagProducerDescriptor,
  cc: ConditionCode
): boolean {
  return flagProducerConditionKind({ producer: descriptor.producer, cc }) !== undefined;
}

export function flagProducerConditionInputNames(
  condition: Pick<SirFlagProducerConditionOp, "cc" | "producer">
): readonly string[] {
  if (flagProducerConditionKind(condition) === undefined) {
    throw new Error(`unsupported flag producer condition: ${condition.producer}/${condition.cc}`);
  }

  return ["left", "right"];
}

export function requiredFlagProducerConditionInput(
  condition: SirFlagProducerConditionDescriptor,
  name: string
): ValueRef {
  const input = condition.inputs[name];

  if (input === undefined) {
    throw new Error(`missing flag producer condition input '${name}' for ${condition.producer}/${condition.cc}`);
  }

  return input;
}
