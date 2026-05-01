import { CONDITIONS, type FlagBoolExpr } from "../../arch/x86/sir/conditions.js";
import type { ConditionCode } from "../../arch/x86/sir/types.js";
import { x86ArithmeticFlagMask } from "../../arch/x86/isa/flags.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import type { WasmSirAluFlagsStorage } from "./alu-flags.js";

export function emitCondition(
  body: WasmFunctionBodyEncoder,
  aluFlags: WasmSirAluFlagsStorage,
  cc: ConditionCode
): void {
  emitFlagBoolExpr(body, aluFlags, CONDITIONS[cc].expr);
}

function emitFlagBoolExpr(
  body: WasmFunctionBodyEncoder,
  aluFlags: WasmSirAluFlagsStorage,
  expr: FlagBoolExpr
): void {
  switch (expr.kind) {
    case "flag":
      aluFlags.emitLoad();
      body.i32Const(x86ArithmeticFlagMask[expr.flag]).i32And().i32Eqz().i32Eqz();
      return;
    case "not":
      emitFlagBoolExpr(body, aluFlags, expr.value);
      body.i32Eqz();
      return;
    case "and":
      emitFlagBoolExpr(body, aluFlags, expr.a);
      emitFlagBoolExpr(body, aluFlags, expr.b);
      body.i32And();
      return;
    case "or":
      emitFlagBoolExpr(body, aluFlags, expr.a);
      emitFlagBoolExpr(body, aluFlags, expr.b);
      body.i32Or();
      return;
    case "xor":
      emitFlagBoolExpr(body, aluFlags, expr.a);
      emitFlagBoolExpr(body, aluFlags, expr.b);
      body.i32Xor();
      return;
  }
}
