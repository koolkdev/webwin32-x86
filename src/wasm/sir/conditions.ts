import { CONDITIONS, type FlagBoolExpr } from "../../arch/x86/sir/conditions.js";
import type { SirValueExpr } from "../../arch/x86/sir/expressions.js";
import {
  flagProducerConditionKind,
  requiredFlagProducerConditionInput
} from "../../arch/x86/sir/flag-conditions.js";
import type { ConditionCode } from "../../arch/x86/sir/types.js";
import { x86ArithmeticFlagMask } from "../../arch/x86/isa/flags.js";
import { i32 } from "../../core/state/cpu-state.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import type { WasmSirAluFlagsStorage } from "./alu-flags.js";
import type { WasmSirEmitHelpers } from "./lower.js";

export function emitAluFlagsCondition(
  body: WasmFunctionBodyEncoder,
  aluFlags: WasmSirAluFlagsStorage,
  cc: ConditionCode
): void {
  emitFlagBoolExpr(body, aluFlags, CONDITIONS[cc].expr);
}

export function emitFlagProducerCondition(
  body: WasmFunctionBodyEncoder,
  condition: Extract<SirValueExpr, { kind: "flagProducer.condition" }>,
  helpers: WasmSirEmitHelpers
): void {
  switch (flagProducerConditionKind(condition)) {
    case "eq32":
      emitInputCompare(body, condition, helpers);
      body.i32Xor().i32Eqz();
      return;
    case "ne32":
      emitInputCompare(body, condition, helpers);
      body.i32Xor().i32Eqz().i32Eqz();
      return;
    case "uLt32":
      emitInputCompare(body, condition, helpers);
      body.i32LtU();
      return;
    case "uGe32":
      emitInputCompare(body, condition, helpers);
      body.i32LtU().i32Eqz();
      return;
    case "sLt32":
      emitSignedInputCompare(body, condition, helpers);
      body.i32LtU();
      return;
    case "sGe32":
      emitSignedInputCompare(body, condition, helpers);
      body.i32LtU().i32Eqz();
      return;
    case "sLe32":
      emitSignedInputCompare(body, condition, helpers);
      body.i32GtU().i32Eqz();
      return;
    case "sGt32":
      emitSignedInputCompare(body, condition, helpers);
      body.i32GtU();
      return;
    case undefined:
      throw new Error(`unsupported flag producer condition: ${condition.producer}/${condition.cc}`);
  }
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

function emitInputCompare(
  body: WasmFunctionBodyEncoder,
  condition: Extract<SirValueExpr, { kind: "flagProducer.condition" }>,
  helpers: WasmSirEmitHelpers
): void {
  helpers.emitValue(requiredFlagProducerConditionInput(condition, "left"));
  helpers.emitValue(requiredFlagProducerConditionInput(condition, "right"));
}

function emitSignedInputCompare(
  body: WasmFunctionBodyEncoder,
  condition: Extract<SirValueExpr, { kind: "flagProducer.condition" }>,
  helpers: WasmSirEmitHelpers
): void {
  emitSignedCompareInput(body, helpers, requiredFlagProducerConditionInput(condition, "left"));
  emitSignedCompareInput(body, helpers, requiredFlagProducerConditionInput(condition, "right"));
}

function emitSignedCompareInput(
  body: WasmFunctionBodyEncoder,
  helpers: WasmSirEmitHelpers,
  value: SirValueExpr
): void {
  helpers.emitValue(value);
  body.i32Const(i32(0x8000_0000)).i32Xor();
}
