import { strictEqual } from "node:assert";
import { test } from "node:test";

import type { IrValueExpr } from "../../../x86/ir/expressions.js";
import { IR_ALU_FLAG_MASKS } from "../../../x86/ir/flag-analysis.js";
import { createIrFlagSetOp } from "../../../x86/ir/flags.js";
import type { ValueRef } from "../../../x86/ir/types.js";
import { i32 } from "../../../x86/state/cpu-state.js";
import { WasmFunctionBodyEncoder } from "../../encoder/function-body.js";
import { wasmOpcode, wasmValueType } from "../../encoder/types.js";
import { wasmBodyOpcodes } from "../../tests/body-opcodes.js";
import { createJitFlagState } from "../flag-state.js";

test("JIT flag state materializes only requested pending flags", () => {
  const body = new WasmFunctionBodyEncoder(3);
  const aluFlagsLocal = body.addLocal(wasmValueType.i32);
  const conditionLocal = body.addLocal(wasmValueType.i32);
  const flags = createJitFlagState(body, aluFlagsLocal, {
    emitLoadAluFlags: () => {
      throw new Error("ZF materialization from add32 should not load incoming aluFlags");
    },
    emitLoadAluFlagsValue: () => {
      throw new Error("ZF materialization from add32 should not merge incoming aluFlags");
    },
    emitStoreAluFlags: () => {
      throw new Error("flags.materialize should not store aluFlags");
    }
  });

  flags.emitSet(createIrFlagSetOp("add32", { left: v(0), right: v(1), result: v(2) }), {
    emitValue: (value) => emitValueExpr(body, value)
  });
  flags.emitMaterialize(IR_ALU_FLAG_MASKS.ZF);
  flags.emitAluFlagsCondition("E");
  body.localSet(conditionLocal).end();

  const opcodes = wasmBodyOpcodes(body.encode());

  strictEqual(opcodes.includes(wasmOpcode.i32LtU), false);
  strictEqual(opcodes.includes(wasmOpcode.i32Popcnt), false);
  strictEqual(opcodes.includes(wasmOpcode.i32ShrU), false);
});

function emitValueExpr(body: WasmFunctionBodyEncoder, value: IrValueExpr): void {
  switch (value.kind) {
    case "var":
      body.localGet(value.id);
      return;
    case "const32":
      body.i32Const(i32(value.value));
      return;
    case "nextEip":
      throw new Error("nextEip is not a valid flag test input");
    default:
      throw new Error(`unsupported flag test value expression: ${value.kind}`);
  }
}

function v(id: number): ValueRef {
  return { kind: "var", id };
}
