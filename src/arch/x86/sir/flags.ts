import type { FlagProducerName, ValueRef } from "./types.js";

export type FlagName = "CF" | "PF" | "AF" | "ZF" | "SF" | "OF";

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
  define: (inputs: Readonly<Record<InputName, ValueRef>>) => FlagDefs
): FlagProducer<InputName> {
  return { inputs, define };
}

export const FLAG_PRODUCERS = {
  add32: flagProducer(["left", "right", "result"], ({ left, right, result }) => ({
    ...zspFlags(32, result),
    ...addCarryFlags(32, left, right, result)
  })),

  sub32: flagProducer(["left", "right", "result"], ({ left, right, result }) => ({
    ...zspFlags(32, result),
    ...subCarryFlags(32, left, right, result)
  })),

  logic32: flagProducer(["result"], ({ result }) => logicFlags(32, result))
} as const satisfies Record<FlagProducerName, FlagProducer<string>>;
