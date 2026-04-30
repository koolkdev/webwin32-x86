import type {
  ConditionCode,
  SirOp,
  SirProgram,
  StorageRef,
  ValueRef
} from "../../arch/x86/sir/types.js";
import type { FlagProducerName } from "../../arch/x86/sir/types.js";
import { i32 } from "../../core/state/cpu-state.js";
import type { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";

export type WasmSirLoweringContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  emitGet32(source: StorageRef, helpers: WasmSirEmitHelpers): void;
  emitSet32(target: StorageRef, value: ValueRef, helpers: WasmSirEmitHelpers): void;
  emitAddress32(source: StorageRef, helpers: WasmSirEmitHelpers): void;
  emitSetFlags(producer: FlagProducerName, inputs: Readonly<Record<string, ValueRef>>, helpers: WasmSirEmitHelpers): void;
  emitCondition(cc: ConditionCode): void;
  emitNext(helpers: WasmSirEmitHelpers): void;
  emitNextEip(helpers: WasmSirEmitHelpers): void;
  emitJump(target: ValueRef, helpers: WasmSirEmitHelpers): void;
  emitConditionalJump(condition: ValueRef, taken: ValueRef, notTaken: ValueRef, helpers: WasmSirEmitHelpers): void;
}>;

export type WasmSirEmitHelpers = Readonly<{
  emitValue(value: ValueRef): void;
}>;

export function lowerSirToWasm(program: SirProgram, context: WasmSirLoweringContext): void {
  const vars = new Map<number, number>();
  const helpers: WasmSirEmitHelpers = {
    emitValue: (value) => emitValue(context, vars, value)
  };

  try {
    for (const op of program) {
      lowerSirOp(op, context, vars, helpers);
    }
  } finally {
    for (const local of vars.values()) {
      context.scratch.freeLocal(local);
    }
  }
}

function lowerSirOp(
  op: SirOp,
  context: WasmSirLoweringContext,
  vars: Map<number, number>,
  helpers: WasmSirEmitHelpers
): void {
  switch (op.op) {
    case "get32": {
      const local = localForVar(context, vars, op.dst.id);

      context.emitGet32(op.source, helpers);
      context.body.localSet(local);
      return;
    }
    case "set32":
      context.emitSet32(op.target, op.value, helpers);
      return;
    case "address32": {
      const local = localForVar(context, vars, op.dst.id);

      context.emitAddress32(op.operand, helpers);
      context.body.localSet(local);
      return;
    }
    case "i32.add":
      lowerI32BinaryOp(op.dst.id, op.a, op.b, context, vars, "add");
      return;
    case "i32.sub":
      lowerI32BinaryOp(op.dst.id, op.a, op.b, context, vars, "sub");
      return;
    case "i32.xor":
      lowerI32BinaryOp(op.dst.id, op.a, op.b, context, vars, "xor");
      return;
    case "i32.and":
      lowerI32BinaryOp(op.dst.id, op.a, op.b, context, vars, "and");
      return;
    case "flags.set":
      context.emitSetFlags(op.producer, op.inputs, helpers);
      return;
    case "condition": {
      const local = localForVar(context, vars, op.dst.id);

      context.emitCondition(op.cc);
      context.body.localSet(local);
      return;
    }
    case "next":
      context.emitNext(helpers);
      return;
    case "jump":
      context.emitJump(op.target, helpers);
      return;
    case "conditionalJump":
      context.emitConditionalJump(op.condition, op.taken, op.notTaken, helpers);
      return;
    default:
      throw new Error(`unsupported SIR op for Wasm lowering: ${op.op}`);
  }
}

function lowerI32BinaryOp(
  dstId: number,
  a: ValueRef,
  b: ValueRef,
  context: WasmSirLoweringContext,
  vars: Map<number, number>,
  op: "add" | "sub" | "xor" | "and"
): void {
  const local = localForVar(context, vars, dstId);

  emitValue(context, vars, a);
  emitValue(context, vars, b);

  switch (op) {
    case "add":
      context.body.i32Add();
      break;
    case "sub":
      context.body.i32Sub();
      break;
    case "xor":
      context.body.i32Xor();
      break;
    case "and":
      context.body.i32And();
      break;
  }

  context.body.localSet(local);
}

function emitValue(context: WasmSirLoweringContext, vars: Map<number, number>, value: ValueRef): void {
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
