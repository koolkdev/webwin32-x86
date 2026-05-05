import { strictEqual } from "node:assert";
import { test } from "node:test";

import type { IrValueExpr } from "#backends/wasm/codegen/expressions.js";
import { IR_ALU_FLAG_MASKS } from "#x86/ir/model/flag-effects.js";
import { createIrFlagSetOp } from "#x86/ir/model/flags.js";
import type { ValueRef } from "#x86/ir/model/types.js";
import { i32 } from "#x86/state/cpu-state.js";
import { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { wasmOpcode, wasmValueType } from "#backends/wasm/encoder/types.js";
import { wasmBodyOpcodes } from "#backends/wasm/tests/body-opcodes.js";
import { createJitFlagState } from "#backends/wasm/jit/state/flag-state.js";
import {
  constValueWidth,
  emitMaskValueToWidth,
  untrackedValueWidth,
  type ValueWidth
} from "#backends/wasm/codegen/value-width.js";

test("JIT flag state materializes only requested pending flags", () => {
  const body = new WasmFunctionBodyEncoder(3);
  const aluFlagsLocal = body.addLocal(wasmValueType.i32);
  const conditionLocal = body.addLocal(wasmValueType.i32);
  const flags = createJitFlagState(body, aluFlagsLocal, {
    emitLoadAluFlags: () => {
      throw new Error("ZF materialization from add should not load incoming aluFlags");
    },
    emitLoadAluFlagsValue: () => {
      throw new Error("ZF materialization from add should not merge incoming aluFlags");
    },
    emitStoreAluFlags: () => {
      throw new Error("flags.materialize should not store aluFlags");
    }
  });

  flags.emitSet(createIrFlagSetOp("add", { left: v(0), right: v(1), result: v(2) }), {
    emitValue: (value) => emitValueExpr(body, value),
    emitMaskedValue: (value, width) => emitMaskValueToWidth(body, width, emitValueExpr(body, value))
  });
  flags.emitMaterialize(IR_ALU_FLAG_MASKS.ZF);
  flags.emitAluFlagsCondition("E");
  body.localSet(conditionLocal).end();

  const opcodes = wasmBodyOpcodes(body.encode());

  strictEqual(opcodes.includes(wasmOpcode.i32LtU), false);
  strictEqual(opcodes.includes(wasmOpcode.i32Popcnt), false);
  strictEqual(opcodes.includes(wasmOpcode.i32ShrU), false);
});

test("JIT flag state emits supported pending flag conditions directly", () => {
  const body = new WasmFunctionBodyEncoder(3);
  const aluFlagsLocal = body.addLocal(wasmValueType.i32);
  const conditionLocal = body.addLocal(wasmValueType.i32);
  const flags = createJitFlagState(body, aluFlagsLocal, {
    emitLoadAluFlags: () => {
      throw new Error("direct sub condition should not load incoming aluFlags");
    },
    emitLoadAluFlagsValue: () => {
      throw new Error("direct sub condition should not merge incoming aluFlags");
    },
    emitStoreAluFlags: () => {
      throw new Error("direct sub condition should not store aluFlags");
    }
  });

  flags.emitSet(createIrFlagSetOp("sub", { left: v(0), right: v(1), result: v(2) }), {
    emitValue: (value) => emitValueExpr(body, value),
    emitMaskedValue: (value, width) => emitMaskValueToWidth(body, width, emitValueExpr(body, value))
  });
  flags.emitAluFlagsCondition("E");
  body.localSet(conditionLocal).end();

  strictEqual(countOpcode(wasmBodyOpcodes(body.encode()), wasmOpcode.localSet), 4);
});

test("JIT flag state keeps const32 pending flag inputs direct", () => {
  const body = new WasmFunctionBodyEncoder(3);
  const aluFlagsLocal = body.addLocal(wasmValueType.i32);
  const conditionLocal = body.addLocal(wasmValueType.i32);
  const flags = createJitFlagState(body, aluFlagsLocal, {
    emitLoadAluFlags: () => {
      throw new Error("direct sub condition should not load incoming aluFlags");
    },
    emitLoadAluFlagsValue: () => {
      throw new Error("direct sub condition should not merge incoming aluFlags");
    },
    emitStoreAluFlags: () => {
      throw new Error("direct sub condition should not store aluFlags");
    }
  });

  flags.emitSet(createIrFlagSetOp("sub", { left: v(0), right: c32(1), result: v(1) }), {
    emitValue: (value) => emitValueExpr(body, value),
    emitMaskedValue: (value, width) => emitMaskValueToWidth(body, width, emitValueExpr(body, value))
  });
  flags.emitAluFlagsCondition("E");
  body.localSet(conditionLocal).end();

  strictEqual(countOpcode(wasmBodyOpcodes(body.encode()), wasmOpcode.localSet), 3);
});

function emitValueExpr(body: WasmFunctionBodyEncoder, value: IrValueExpr): ValueWidth {
  switch (value.kind) {
    case "var":
      body.localGet(value.id);
      return untrackedValueWidth();
    case "const32":
      body.i32Const(i32(value.value));
      return constValueWidth(value.value);
    case "nextEip":
      throw new Error("nextEip is not a valid flag test input");
    default:
      throw new Error(`unsupported flag test value expression: ${value.kind}`);
  }
}

function v(id: number): ValueRef {
  return { kind: "var", id };
}

function c32(value: number): ValueRef {
  return { kind: "const32", value };
}

function countOpcode(opcodes: readonly number[], opcode: number): number {
  return opcodes.filter((entry) => entry === opcode).length;
}
