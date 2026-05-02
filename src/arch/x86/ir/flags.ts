import { x86ArithmeticFlagMask } from "../isa/flags.js";
import type { X86ArithmeticFlag } from "../isa/flags.js";
import type { ConditionCode, FlagProducerName, IrFlagProducerConditionOp, IrFlagSetOp, ValueRef, VarRef } from "./types.js";

export type FlagName = X86ArithmeticFlag;

export type ValueExpr =
  | ValueRef
  | Readonly<{ kind: "and"; a: ValueExpr; b: ValueExpr }>
  | Readonly<{ kind: "xor"; a: ValueExpr; b: ValueExpr }>;

export type FlagExpr =
  | Readonly<{ kind: "constFlag"; value: 0 | 1 }>
  | Readonly<{ kind: "undefFlag" }>
  | Readonly<{ kind: "eqz"; value: ValueExpr }>
  | Readonly<{ kind: "ne0"; value: ValueExpr }>
  | Readonly<{ kind: "uLt"; a: ValueExpr; b: ValueExpr }>
  | Readonly<{ kind: "bit"; value: ValueExpr; bit: number }>
  | Readonly<{ kind: "parity8"; value: ValueExpr }>
  | Readonly<{ kind: "signBit"; value: ValueExpr; width: 8 | 16 | 32 }>;

export type FlagDefs = Readonly<Partial<Record<FlagName, FlagExpr>>>;

export type FlagProducer<InputName extends string> = Readonly<{
  inputs: readonly InputName[];
  // Masks are explicit metadata so analysis can reason about partial writers
  // without inspecting every symbolic expression. The define() result must
  // still provide expressions for every written bit.
  writtenMask: number;
  undefMask: number;
  define(inputs: Readonly<Record<InputName, ValueRef>>): FlagDefs;
}>;

export const constFlag = (value: 0 | 1): FlagExpr => ({ kind: "constFlag", value });
export const undefFlag = (): FlagExpr => ({ kind: "undefFlag" });
export const eqz = (value: ValueExpr): FlagExpr => ({ kind: "eqz", value });
export const ne0 = (value: ValueExpr): FlagExpr => ({ kind: "ne0", value });
export const uLt = (a: ValueExpr, b: ValueExpr): FlagExpr => ({ kind: "uLt", a, b });
export const bit = (value: ValueExpr, bitIndex: number): FlagExpr => ({
  kind: "bit",
  value,
  bit: bitIndex
});
export const parity8 = (value: ValueExpr): FlagExpr => ({ kind: "parity8", value });
export const signBit = (value: ValueExpr, width: 8 | 16 | 32): FlagExpr => ({
  kind: "signBit",
  value,
  width
});

export const and = (a: ValueExpr, b: ValueExpr): ValueExpr => ({ kind: "and", a, b });
export const xor = (a: ValueExpr, b: ValueExpr): ValueExpr => ({ kind: "xor", a, b });
export const xor3 = (a: ValueExpr, b: ValueExpr, c: ValueExpr): ValueExpr => xor(xor(a, b), c);

export const signMask = (width: 8 | 16 | 32): ValueExpr => ({
  kind: "const32",
  value: width === 32 ? 0x8000_0000 : width === 16 ? 0x8000 : 0x80
});

export function zspFlags(width: 8 | 16 | 32, result: ValueExpr): FlagDefs {
  return {
    ZF: eqz(result),
    SF: signBit(result, width),
    PF: parity8(result)
  };
}

export function addCarryFlags(
  width: 8 | 16 | 32,
  left: ValueExpr,
  right: ValueExpr,
  result: ValueExpr
): FlagDefs {
  return {
    CF: uLt(result, left),
    AF: bit(xor3(left, right, result), 4),
    OF: ne0(and(and(xor(left, result), xor(right, result)), signMask(width)))
  };
}

export function subCarryFlags(
  width: 8 | 16 | 32,
  left: ValueExpr,
  right: ValueExpr,
  result: ValueExpr
): FlagDefs {
  return {
    CF: uLt(left, right),
    AF: bit(xor3(left, right, result), 4),
    OF: ne0(and(and(xor(left, right), xor(left, result)), signMask(width)))
  };
}

export function logicFlags(width: 8 | 16 | 32, result: ValueExpr): FlagDefs {
  return {
    ...zspFlags(width, result),
    CF: constFlag(0),
    OF: constFlag(0),
    AF: undefFlag()
  };
}

export function flagProducer<const InputName extends string>(
  inputs: readonly InputName[],
  writtenFlags: readonly FlagName[],
  undefFlags: readonly FlagName[],
  define: (inputs: Readonly<Record<InputName, ValueRef>>) => FlagDefs
): FlagProducer<InputName> {
  return {
    inputs,
    writtenMask: maskFlags(writtenFlags),
    undefMask: maskFlags(undefFlags),
    define
  };
}

const arithmeticFlagNames = ["CF", "PF", "AF", "ZF", "SF", "OF"] as const satisfies readonly FlagName[];
const incDecWrittenFlagNames = ["PF", "AF", "ZF", "SF", "OF"] as const satisfies readonly FlagName[];

export const FLAG_PRODUCERS = {
  add32: flagProducer(["left", "right", "result"], arithmeticFlagNames, [], ({ left, right, result }) => ({
    ...zspFlags(32, result),
    ...addCarryFlags(32, left, right, result)
  })),

  sub32: flagProducer(["left", "right", "result"], arithmeticFlagNames, [], ({ left, right, result }) => ({
    ...zspFlags(32, result),
    ...subCarryFlags(32, left, right, result)
  })),

  logic32: flagProducer(["result"], arithmeticFlagNames, ["AF"], ({ result }) => logicFlags(32, result)),

  // INC/DEC intentionally omit CF from writtenMask. Consumers of CF after INC/DEC
  // must keep using the previous CF source.
  inc32: flagProducer(["left", "result"], incDecWrittenFlagNames, [], ({ left, result }) => {
    const carry = addCarryFlags(32, left, const32(1), result);

    return {
      ...zspFlags(32, result),
      AF: requiredFlagExpr(carry, "AF", "inc32"),
      OF: requiredFlagExpr(carry, "OF", "inc32")
    };
  }),

  dec32: flagProducer(["left", "result"], incDecWrittenFlagNames, [], ({ left, result }) => {
    const carry = subCarryFlags(32, left, const32(1), result);

    return {
      ...zspFlags(32, result),
      AF: requiredFlagExpr(carry, "AF", "dec32"),
      OF: requiredFlagExpr(carry, "OF", "dec32")
    };
  })
} as const satisfies Record<FlagProducerName, FlagProducer<string>>;

export function createIrFlagSetOp(
  producer: FlagProducerName,
  inputs: Readonly<Record<string, ValueRef>>
): IrFlagSetOp {
  const flagProducer = FLAG_PRODUCERS[producer];

  return {
    op: "flags.set",
    producer,
    writtenMask: flagProducer.writtenMask,
    undefMask: flagProducer.undefMask,
    inputs
  };
}

export function createIrFlagProducerConditionOp(
  dst: VarRef,
  cc: ConditionCode,
  descriptor: IrFlagSetOp
): IrFlagProducerConditionOp {
  return {
    op: "flagProducer.condition",
    dst,
    cc,
    producer: descriptor.producer,
    writtenMask: descriptor.writtenMask,
    undefMask: descriptor.undefMask,
    inputs: descriptor.inputs
  };
}

function const32(value: number): ValueExpr {
  return { kind: "const32", value };
}

function maskFlags(flags: readonly FlagName[]): number {
  return flags.reduce((mask, flag) => mask | x86ArithmeticFlagMask[flag], 0);
}

function requiredFlagExpr(defs: FlagDefs, flag: FlagName, producer: FlagProducerName): FlagExpr {
  const expr = defs[flag];

  if (expr === undefined) {
    throw new Error(`${producer} missing generated ${flag} expression`);
  }

  return expr;
}
