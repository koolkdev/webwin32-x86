import {
  buildSirExpressionProgram,
  type SirExpressionOptions,
  type SirExprOp,
  type SirExprProgram,
  type SirStorageExpr,
  type SirValueExpr
} from "../../arch/x86/sir/expressions.js";
import type {
  ConditionCode,
  SirProgram,
  ValueRef
} from "../../arch/x86/sir/types.js";
import type { FlagProducerName } from "../../arch/x86/sir/types.js";
import { i32 } from "../../core/state/cpu-state.js";
import type { WasmLocalScratchAllocator } from "../encoder/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";

export type WasmSirLoweringContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  expression?: SirExpressionOptions;
  emitGet32(source: SirStorageExpr, helpers: WasmSirEmitHelpers): void;
  emitSet32(target: SirStorageExpr, value: SirValueExpr, helpers: WasmSirEmitHelpers): void;
  emitAddress32(source: SirStorageExpr, helpers: WasmSirEmitHelpers): void;
  emitSetFlags(producer: FlagProducerName, inputs: Readonly<Record<string, ValueRef>>, helpers: WasmSirEmitHelpers): void;
  emitCondition(cc: ConditionCode): void;
  emitNext(helpers: WasmSirEmitHelpers): void;
  emitNextEip(helpers: WasmSirEmitHelpers): void;
  emitJump(target: SirValueExpr, helpers: WasmSirEmitHelpers): void;
  emitConditionalJump(condition: SirValueExpr, taken: SirValueExpr, notTaken: SirValueExpr, helpers: WasmSirEmitHelpers): void;
  emitHostTrap(vector: SirValueExpr, helpers: WasmSirEmitHelpers): void;
}>;

export type WasmSirEmitHelpers = Readonly<{
  emitValue(value: SirValueExpr): void;
}>;

export function lowerSirToWasm(program: SirProgram, context: WasmSirLoweringContext): void {
  lowerSirExpressionProgramToWasm(buildSirExpressionProgram(program, context.expression), context);
}

function lowerSirExpressionProgramToWasm(program: SirExprProgram, context: WasmSirLoweringContext): void {
  const vars = new Map<number, number>();
  const helpers: WasmSirEmitHelpers = {
    emitValue: (value) => emitValue(context, vars, value)
  };

  try {
    for (const op of program) {
      lowerSirExprOp(op, context, vars, helpers);
    }
  } finally {
    for (const local of vars.values()) {
      context.scratch.freeLocal(local);
    }
  }
}

function lowerSirExprOp(
  op: SirExprOp,
  context: WasmSirLoweringContext,
  vars: Map<number, number>,
  helpers: WasmSirEmitHelpers
): void {
  switch (op.op) {
    case "let32": {
      const local = localForVar(context, vars, op.dst.id);

      emitValue(context, vars, op.value);
      context.body.localSet(local);
      return;
    }
    case "set32":
      context.emitSet32(op.target, op.value, helpers);
      return;
    case "flags.set":
      context.emitSetFlags(op.producer, op.inputs, helpers);
      return;
    case "next":
      context.emitNext(helpers);
      return;
    case "jump":
      context.emitJump(op.target, helpers);
      return;
    case "conditionalJump":
      context.emitConditionalJump(op.condition, op.taken, op.notTaken, helpers);
      return;
    case "hostTrap":
      context.emitHostTrap(op.vector, helpers);
      return;
  }
}

function emitValue(context: WasmSirLoweringContext, vars: Map<number, number>, value: SirValueExpr): void {
  switch (value.kind) {
    case "var":
      context.body.localGet(requiredVarLocal(vars, value.id));
      return;
    case "const32":
      context.body.i32Const(i32(value.value));
      return;
    case "nextEip":
      context.emitNextEip({ emitValue: (nested) => emitValue(context, vars, nested) });
      return;
    case "src32":
      context.emitGet32(value.source, { emitValue: (nested) => emitValue(context, vars, nested) });
      return;
    case "address32":
      context.emitAddress32(value.operand, { emitValue: (nested) => emitValue(context, vars, nested) });
      return;
    case "condition":
      context.emitCondition(value.cc);
      return;
    case "i32.add":
      emitValue(context, vars, value.a);
      emitValue(context, vars, value.b);
      context.body.i32Add();
      return;
    case "i32.sub":
      emitValue(context, vars, value.a);
      emitValue(context, vars, value.b);
      context.body.i32Sub();
      return;
    case "i32.xor":
      emitValue(context, vars, value.a);
      emitValue(context, vars, value.b);
      context.body.i32Xor();
      return;
    case "i32.and":
      emitValue(context, vars, value.a);
      emitValue(context, vars, value.b);
      context.body.i32And();
      return;
  }
}

function localForVar(context: WasmSirLoweringContext, vars: Map<number, number>, id: number): number {
  let local = vars.get(id);

  if (local === undefined) {
    local = context.scratch.allocLocal(wasmValueType.i32);
    vars.set(id, local);
  }

  return local;
}

function requiredVarLocal(vars: Map<number, number>, id: number): number {
  const local = vars.get(id);

  if (local === undefined) {
    throw new Error(`missing Wasm local for SIR var: ${id}`);
  }

  return local;
}
