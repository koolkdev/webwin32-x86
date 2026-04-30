import { CONDITIONS, type FlagBoolExpr } from "../../arch/x86/sir/conditions.js";
import type { ConditionCode } from "../../arch/x86/sir/types.js";
import { eflagsMask } from "../../core/state/cpu-state.js";
import { stateOffset } from "../abi.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { emitLoadStateU32 } from "../interpreter/state.js";

export function emitCondition(body: WasmFunctionBodyEncoder, eflagsLocal: number | undefined, cc: ConditionCode): void {
  emitFlagBoolExpr(body, eflagsLocal, CONDITIONS[cc].expr);
}

function emitFlagBoolExpr(body: WasmFunctionBodyEncoder, eflagsLocal: number | undefined, expr: FlagBoolExpr): void {
  switch (expr.kind) {
    case "flag":
      if (eflagsLocal === undefined) {
        emitLoadStateU32(body, stateOffset.eflags);
      } else {
        body.localGet(eflagsLocal);
      }
      body.i32Const(eflagsMask[expr.flag]).i32And().i32Eqz().i32Eqz();
      return;
    case "not":
      emitFlagBoolExpr(body, eflagsLocal, expr.value);
      body.i32Eqz();
      return;
    case "and":
      emitFlagBoolExpr(body, eflagsLocal, expr.a);
      emitFlagBoolExpr(body, eflagsLocal, expr.b);
      body.i32And();
      return;
    case "or":
      emitFlagBoolExpr(body, eflagsLocal, expr.a);
      emitFlagBoolExpr(body, eflagsLocal, expr.b);
      body.i32Or();
      return;
    case "xor":
      emitFlagBoolExpr(body, eflagsLocal, expr.a);
      emitFlagBoolExpr(body, eflagsLocal, expr.b);
      body.i32Xor();
      return;
  }
}
