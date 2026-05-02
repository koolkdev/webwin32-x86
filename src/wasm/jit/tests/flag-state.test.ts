import { strictEqual } from "node:assert";
import { test } from "node:test";

import type { SirValueExpr } from "../../../arch/x86/sir/expressions.js";
import { SIR_ALU_FLAG_MASKS } from "../../../arch/x86/sir/flag-analysis.js";
import type { ValueRef } from "../../../arch/x86/sir/types.js";
import { i32 } from "../../../core/state/cpu-state.js";
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

  flags.emitSet("add32", { left: v(0), right: v(1), result: v(2) }, {
    emitValue: (value) => emitValueExpr(body, value)
  });
  flags.emitMaterialize(SIR_ALU_FLAG_MASKS.ZF);
  flags.emitCondition("E");
  body.localSet(conditionLocal).end();

  const opcodes = wasmBodyOpcodes(body.encode());

  strictEqual(opcodes.includes(wasmOpcode.i32LtU), false);
  strictEqual(opcodes.includes(wasmOpcode.i32Popcnt), false);
  strictEqual(opcodes.includes(wasmOpcode.i32ShrU), false);
});

function emitValueExpr(body: WasmFunctionBodyEncoder, value: SirValueExpr): void {
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
