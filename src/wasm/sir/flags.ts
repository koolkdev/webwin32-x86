import type {
  FlagExpr,
  FlagName,
  ValueExpr
} from "../../arch/x86/sir/flags.js";
import { FLAG_PRODUCERS } from "../../arch/x86/sir/flags.js";
import type { FlagProducerName, ValueRef } from "../../arch/x86/sir/types.js";
import { eflagsMask, i32 } from "../../core/state/cpu-state.js";
import { stateOffset } from "../abi.js";
import type { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import { emitLoadStateU32, emitStoreStateU32 } from "../interpreter/state.js";
import type { WasmSirEmitHelpers } from "./lower.js";

const flagOrder = ["CF", "PF", "AF", "ZF", "SF", "OF"] as const satisfies readonly FlagName[];

export function emitSetFlags(
  body: WasmFunctionBodyEncoder,
  scratch: WasmLocalScratchAllocator,
  eflagsLocal: number | undefined,
  producer: FlagProducerName,
  inputs: Readonly<Record<string, ValueRef>>,
  helpers: WasmSirEmitHelpers
): void {
  const flagProducer = FLAG_PRODUCERS[producer];
  const defs = flagProducer.define(inputs);
  const flagsLocal = scratch.allocLocal(wasmValueType.i32);

  try {
    body.i32Const(0).localSet(flagsLocal);

    for (const flag of flagOrder) {
      const expr = defs[flag];

      if (expr !== undefined) {
        emitOrFlag(body, flagsLocal, flag, expr, helpers);
      }
    }

    if (eflagsLocal === undefined) {
      emitStoreStateU32(body, stateOffset.eflags, () => {
        emitLoadStateU32(body, stateOffset.eflags);
        body.i32Const(i32(~writtenFlagsMask(defs))).i32And().localGet(flagsLocal).i32Or();
      });
    } else {
      body
        .localGet(eflagsLocal)
        .i32Const(i32(~writtenFlagsMask(defs)))
        .i32And()
        .localGet(flagsLocal)
        .i32Or()
        .localSet(eflagsLocal);
    }
  } finally {
    scratch.freeLocal(flagsLocal);
  }
}

function emitOrFlag(
  body: WasmFunctionBodyEncoder,
  flagsLocal: number,
  flag: FlagName,
  expr: FlagExpr,
  helpers: WasmSirEmitHelpers
): void {
  body.localGet(flagsLocal);
  emitFlagExpr(body, expr, helpers);
  body.i32Const(flagBit(flag)).i32Shl().i32Or().localSet(flagsLocal);
}

function emitFlagExpr(body: WasmFunctionBodyEncoder, expr: FlagExpr, helpers: WasmSirEmitHelpers): void {
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

function emitValueExpr(body: WasmFunctionBodyEncoder, expr: ValueExpr, helpers: WasmSirEmitHelpers): void {
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

function writtenFlagsMask(defs: Readonly<Partial<Record<FlagName, FlagExpr>>>): number {
  return flagOrder.reduce((mask, flag) => (defs[flag] === undefined ? mask : mask | eflagsMask[flag]), 0);
}

function flagBit(flag: FlagName): number {
  return Math.log2(eflagsMask[flag]);
}

function signMask(width: 8 | 16 | 32): number {
  return width === 32 ? i32(0x8000_0000) : width === 16 ? 0x8000 : 0x80;
}
