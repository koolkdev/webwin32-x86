import {
  x86ArithmeticFlagMask,
  x86ArithmeticFlags,
  x86ArithmeticFlagsMask
} from "../../x86/isa/flags.js";
import type {
  FlagExpr,
  FlagName,
  ValueExpr
} from "../../x86/ir/flags.js";
import { FLAG_PRODUCERS } from "../../x86/ir/flags.js";
import type { IrFlagSetOp } from "../../x86/ir/types.js";
import { i32 } from "../../x86/state/cpu-state.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import type { WasmIrAluFlagsStorage } from "./alu-flags.js";
import type { WasmIrEmitHelpers } from "./lower.js";

const flagOrder = x86ArithmeticFlags satisfies readonly FlagName[];

export type EmitSetFlagsOptions = Readonly<{
  mask?: number;
}>;

export function emitSetFlags(
  body: WasmFunctionBodyEncoder,
  aluFlags: WasmIrAluFlagsStorage,
  descriptor: IrFlagSetOp,
  helpers: WasmIrEmitHelpers,
  options: EmitSetFlagsOptions = {}
): void {
  const flagProducer = FLAG_PRODUCERS[descriptor.producer];
  const defs = flagProducer.define(descriptor.inputs);
  // Masked materialization computes only requested bits; partial producers also
  // preserve bits outside writtenMask, such as CF for INC/DEC.
  const writeMask = descriptor.writtenMask & (options.mask ?? x86ArithmeticFlagsMask);

  if (writeMask === 0) {
    return;
  }

  aluFlags.emitStore(() => {
    aluFlags.emitLoad();
    body.i32Const(i32(x86ArithmeticFlagsMask & ~writeMask)).i32And();
    emitWrittenFlags(body, defs, helpers, writeMask);
    body.i32Or();
  });
}

function emitWrittenFlags(
  body: WasmFunctionBodyEncoder,
  defs: Readonly<Partial<Record<FlagName, FlagExpr>>>,
  helpers: WasmIrEmitHelpers,
  mask: number
): void {
  let hasWrittenFlag = false;

  for (const flag of flagOrder) {
    if ((mask & x86ArithmeticFlagMask[flag]) === 0) {
      continue;
    }

    const expr = defs[flag];

    if (expr === undefined) {
      throw new Error(`flag producer metadata writes ${flag} without defining it`);
    }

    emitFlagBit(body, flag, expr, helpers);

    if (hasWrittenFlag) {
      body.i32Or();
    } else {
      hasWrittenFlag = true;
    }
  }

  if (!hasWrittenFlag) {
    body.i32Const(0);
  }
}

function emitFlagBit(
  body: WasmFunctionBodyEncoder,
  flag: FlagName,
  expr: FlagExpr,
  helpers: WasmIrEmitHelpers
): void {
  emitFlagExpr(body, expr, helpers);
  body.i32Const(flagBit(flag)).i32Shl();
}

function emitFlagExpr(body: WasmFunctionBodyEncoder, expr: FlagExpr, helpers: WasmIrEmitHelpers): void {
  switch (expr.kind) {
    case "constFlag":
      body.i32Const(expr.value);
      return;
    case "undefFlag":
      body.i32Const(0);
      return;
    case "eqz":
      emitValueExpr(body, expr.value, helpers);
      body.i32Eqz();
      return;
    case "ne0":
      emitValueExpr(body, expr.value, helpers);
      body.i32Eqz().i32Eqz();
      return;
    case "uLt":
      emitValueExpr(body, expr.a, helpers);
      emitValueExpr(body, expr.b, helpers);
      body.i32LtU();
      return;
    case "bit":
      emitValueExpr(body, expr.value, helpers);
      body.i32Const(expr.bit).i32ShrU().i32Const(1).i32And();
      return;
    case "parity8":
      emitValueExpr(body, expr.value, helpers);
      body.i32Const(0xff).i32And().i32Popcnt().i32Const(1).i32And().i32Eqz();
      return;
    case "signBit":
      emitValueExpr(body, expr.value, helpers);
      body.i32Const(signMask(expr.width)).i32And().i32Eqz().i32Eqz();
      return;
  }
}

function emitValueExpr(body: WasmFunctionBodyEncoder, expr: ValueExpr, helpers: WasmIrEmitHelpers): void {
  switch (expr.kind) {
    case "var":
    case "const32":
    case "nextEip":
      helpers.emitValue(expr);
      return;
    case "and":
      emitValueExpr(body, expr.a, helpers);
      emitValueExpr(body, expr.b, helpers);
      body.i32And();
      return;
    case "xor":
      emitValueExpr(body, expr.a, helpers);
      emitValueExpr(body, expr.b, helpers);
      body.i32Xor();
      return;
  }
}

function flagBit(flag: FlagName): number {
  return Math.log2(x86ArithmeticFlagMask[flag]);
}

function signMask(width: 8 | 16 | 32): number {
  return width === 32 ? i32(0x8000_0000) : width === 16 ? 0x8000 : 0x80;
}
