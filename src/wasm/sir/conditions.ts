import { CONDITIONS, type FlagBoolExpr } from "../../arch/x86/sir/conditions.js";
import type { ConditionCode } from "../../arch/x86/sir/types.js";
import { eflagsMask } from "../../core/state/cpu-state.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import type { WasmSirEflagsStorage } from "./eflags.js";

export function emitCondition(body: WasmFunctionBodyEncoder, eflags: WasmSirEflagsStorage, cc: ConditionCode): void {
  emitFlagBoolExpr(body, eflags, CONDITIONS[cc].expr);
}

function emitFlagBoolExpr(body: WasmFunctionBodyEncoder, eflags: WasmSirEflagsStorage, expr: FlagBoolExpr): void {
  switch (expr.kind) {
    case "flag":
      eflags.emitLoad();
      body.i32Const(eflagsMask[expr.flag]).i32And().i32Eqz().i32Eqz();
      return;
    case "not":
      emitFlagBoolExpr(body, eflags, expr.value);
      body.i32Eqz();
      return;
    case "and":
      emitFlagBoolExpr(body, eflags, expr.a);
      emitFlagBoolExpr(body, eflags, expr.b);
      body.i32And();
      return;
    case "or":
      emitFlagBoolExpr(body, eflags, expr.a);
      emitFlagBoolExpr(body, eflags, expr.b);
      body.i32Or();
      return;
    case "xor":
      emitFlagBoolExpr(body, eflags, expr.a);
      emitFlagBoolExpr(body, eflags, expr.b);
      body.i32Xor();
      return;
  }
}
