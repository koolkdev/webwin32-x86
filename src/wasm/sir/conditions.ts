import { CONDITIONS, type FlagBoolExpr } from "../../arch/x86/sir/conditions.js";
import type { ConditionCode } from "../../arch/x86/sir/types.js";
import { eflagsMask } from "../../core/state/cpu-state.js";
import { stateOffset } from "../abi.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { emitLoadStateU32 } from "../interpreter/state.js";

export function emitCondition(body: WasmFunctionBodyEncoder, cc: ConditionCode): void {
  emitFlagBoolExpr(body, CONDITIONS[cc].expr);
}

function emitFlagBoolExpr(body: WasmFunctionBodyEncoder, expr: FlagBoolExpr): void {
  switch (expr.kind) {
    case "flag":
      emitLoadStateU32(body, stateOffset.eflags);
      body.i32Const(eflagsMask[expr.flag]).i32And().i32Eqz().i32Eqz();
      return;
    case "not":
      emitFlagBoolExpr(body, expr.value);
      body.i32Eqz();
      return;
    case "and":
      emitFlagBoolExpr(body, expr.a);
      emitFlagBoolExpr(body, expr.b);
      body.i32And();
      return;
    case "or":
      emitFlagBoolExpr(body, expr.a);
      emitFlagBoolExpr(body, expr.b);
      body.i32Or();
      return;
    case "xor":
      emitFlagBoolExpr(body, expr.a);
      emitFlagBoolExpr(body, expr.b);
      body.i32Xor();
      return;
  }
}
