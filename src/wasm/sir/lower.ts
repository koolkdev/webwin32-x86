import type {
  SirOp,
  SirProgram,
  StorageRef,
  ValueRef
} from "../../arch/x86/sir/types.js";
import type { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";

export type WasmSirLoweringContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  emitGet32(source: StorageRef, helpers: WasmSirEmitHelpers): void;
  emitSet32(target: StorageRef, value: ValueRef, helpers: WasmSirEmitHelpers): void;
  emitNext(helpers: WasmSirEmitHelpers): void;
  emitNextEip(helpers: WasmSirEmitHelpers): void;
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
    case "next":
      context.emitNext(helpers);
      return;
    default:
      throw new Error(`unsupported SIR op for Wasm lowering: ${op.op}`);
  }
}

function emitValue(context: WasmSirLoweringContext, vars: Map<number, number>, value: ValueRef): void {
  switch (value.kind) {
    case "var":
      context.body.localGet(requiredVarLocal(vars, value.id));
      return;
    case "const32":
      context.body.i32Const(value.value);
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
