import { CONDITIONS, type FlagBoolExpr } from "#x86/ir/model/conditions.js";
import type { IrValueExpr } from "#x86/ir/model/expressions.js";
import {
  flagProducerConditionKind,
  requiredFlagProducerConditionInput
} from "#x86/ir/model/flag-conditions.js";
import type { ConditionCode } from "#x86/ir/model/types.js";
import { x86ArithmeticFlagMask } from "#x86/isa/flags.js";
import { i32 } from "#x86/state/cpu-state.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import type { WasmIrAluFlagsStorage } from "./alu-flags.js";
import type { WasmIrEmitHelpers } from "./lower.js";

export function emitAluFlagsCondition(
  body: WasmFunctionBodyEncoder,
  aluFlags: WasmIrAluFlagsStorage,
  cc: ConditionCode
): void {
  emitFlagBoolExpr(body, aluFlags, CONDITIONS[cc].expr);
}

export function emitFlagProducerCondition(
  body: WasmFunctionBodyEncoder,
  condition: Extract<IrValueExpr, { kind: "flagProducer.condition" }>,
  helpers: WasmIrEmitHelpers
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
    case "zero32":
      emitResultInput(body, condition, helpers);
      body.i32Eqz();
      return;
    case "nonZero32":
      emitResultInput(body, condition, helpers);
      body.i32Eqz().i32Eqz();
      return;
    case "sign32":
      emitResultSign(body, condition, helpers);
      body.i32Eqz().i32Eqz();
      return;
    case "notSign32":
      emitResultSign(body, condition, helpers);
      body.i32Eqz();
      return;
    case "parity8":
      emitResultParity(body, condition, helpers);
      return;
    case "notParity8":
      emitResultParity(body, condition, helpers);
      body.i32Eqz();
      return;
    case undefined:
      throw new Error(`unsupported flag producer condition: ${condition.producer}/${condition.cc}`);
  }
}

function emitFlagBoolExpr(
  body: WasmFunctionBodyEncoder,
  aluFlags: WasmIrAluFlagsStorage,
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
  condition: Extract<IrValueExpr, { kind: "flagProducer.condition" }>,
  helpers: WasmIrEmitHelpers
): void {
  helpers.emitValue(requiredFlagProducerConditionInput(condition, "left"));
  helpers.emitValue(requiredFlagProducerConditionInput(condition, "right"));
}

function emitSignedInputCompare(
  body: WasmFunctionBodyEncoder,
  condition: Extract<IrValueExpr, { kind: "flagProducer.condition" }>,
  helpers: WasmIrEmitHelpers
): void {
  emitSignedCompareInput(body, helpers, requiredFlagProducerConditionInput(condition, "left"));
  emitSignedCompareInput(body, helpers, requiredFlagProducerConditionInput(condition, "right"));
}

function emitSignedCompareInput(
  body: WasmFunctionBodyEncoder,
  helpers: WasmIrEmitHelpers,
  value: IrValueExpr
): void {
  helpers.emitValue(value);
  body.i32Const(i32(0x8000_0000)).i32Xor();
}

function emitResultInput(
  body: WasmFunctionBodyEncoder,
  condition: Extract<IrValueExpr, { kind: "flagProducer.condition" }>,
  helpers: WasmIrEmitHelpers
): void {
  helpers.emitValue(requiredFlagProducerConditionInput(condition, "result"));
}

function emitResultSign(
  body: WasmFunctionBodyEncoder,
  condition: Extract<IrValueExpr, { kind: "flagProducer.condition" }>,
  helpers: WasmIrEmitHelpers
): void {
  emitResultInput(body, condition, helpers);
  body.i32Const(i32(0x8000_0000)).i32And();
}

function emitResultParity(
  body: WasmFunctionBodyEncoder,
  condition: Extract<IrValueExpr, { kind: "flagProducer.condition" }>,
  helpers: WasmIrEmitHelpers
): void {
  emitResultInput(body, condition, helpers);
  body.i32Const(0xff).i32And().i32Popcnt().i32Const(1).i32And().i32Eqz();
}
