import { strictEqual } from "node:assert";
import { test } from "node:test";

import type { SirValueExpr } from "../../../arch/x86/sir/expressions.js";
import type { ConditionCode, FlagProducerName, ValueRef } from "../../../arch/x86/sir/types.js";
import { eflagsMask, i32 } from "../../../core/state/cpu-state.js";
import { WasmFunctionBodyEncoder } from "../../encoder/function-body.js";
import { WasmModuleEncoder } from "../../encoder/module.js";
import { wasmValueType } from "../../encoder/types.js";
import { emitCondition } from "../conditions.js";
import { wasmSirLocalEflagsStorage } from "../eflags.js";
import { emitSetFlags } from "../flags.js";

const preservedEflagsBit = 1 << 9;

test("emitSetFlags writes generated flags and preserves unrelated eflags bits", async () => {
  const add32 = await instantiateSetFlags("add32");
  const logic32 = await instantiateSetFlags("logic32");

  strictEqual(
    add32(0xffff_ffff, 1, 0, preservedEflagsBit | eflagsMask.SF | eflagsMask.OF),
    preservedEflagsBit | eflagsMask.CF | eflagsMask.PF | eflagsMask.AF | eflagsMask.ZF
  );
  strictEqual(
    logic32(0, 0, 0, preservedEflagsBit | eflagsMask.CF | eflagsMask.AF | eflagsMask.OF),
    preservedEflagsBit | eflagsMask.PF | eflagsMask.ZF
  );
});

test("emitSetFlags does not allocate an accumulator local", () => {
  const body = new WasmFunctionBodyEncoder(4);
  const eflags = wasmSirLocalEflagsStorage(body, 3);

  emitSetFlags(body, eflags, "logic32", { result: v(2) }, {
    emitValue: (value) => emitValueExpr(body, value)
  });
  body.localGet(3).end();

  strictEqual(body.encode()[0], 0);
});

test("emitCondition evaluates compound condition formulas from eflags", async () => {
  const le = await instantiateCondition("LE");
  const g = await instantiateCondition("G");

  strictEqual(le(eflagsMask.ZF), 1);
  strictEqual(le(eflagsMask.SF), 1);
  strictEqual(le(eflagsMask.SF | eflagsMask.OF), 0);

  strictEqual(g(0), 1);
  strictEqual(g(eflagsMask.ZF), 0);
  strictEqual(g(eflagsMask.SF), 0);
  strictEqual(g(eflagsMask.SF | eflagsMask.OF), 1);
});

async function instantiateSetFlags(
  producer: FlagProducerName
): Promise<(left: number, right: number, result: number, eflags: number) => number> {
  const module = await WebAssembly.compile(encodeSetFlagsModule(producer));
  const instance = await WebAssembly.instantiate(module);
  const run = instance.exports.run;

  if (typeof run !== "function") {
    throw new Error("expected exported function 'run'");
  }

  return run as (left: number, right: number, result: number, eflags: number) => number;
}

function encodeSetFlagsModule(producer: FlagProducerName): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  const typeIndex = module.addFunctionType({
    params: [wasmValueType.i32, wasmValueType.i32, wasmValueType.i32, wasmValueType.i32],
    results: [wasmValueType.i32]
  });
  const body = new WasmFunctionBodyEncoder(4);
  const eflags = wasmSirLocalEflagsStorage(body, 3);
  const inputs: Readonly<Record<string, ValueRef>> = producer === "logic32"
    ? { result: v(2) }
    : { left: v(0), right: v(1), result: v(2) };

  emitSetFlags(body, eflags, producer, inputs, {
    emitValue: (value) => emitValueExpr(body, value)
  });
  body.localGet(3).end();

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction("run", functionIndex);

  return module.encode();
}

async function instantiateCondition(cc: ConditionCode): Promise<(eflags: number) => number> {
  const module = await WebAssembly.compile(encodeConditionModule(cc));
  const instance = await WebAssembly.instantiate(module);
  const run = instance.exports.run;

  if (typeof run !== "function") {
    throw new Error("expected exported function 'run'");
  }

  return run as (eflags: number) => number;
}

function encodeConditionModule(cc: ConditionCode): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  const typeIndex = module.addFunctionType({
    params: [wasmValueType.i32],
    results: [wasmValueType.i32]
  });
  const body = new WasmFunctionBodyEncoder(1);

  emitCondition(body, wasmSirLocalEflagsStorage(body, 0), cc);
  body.end();

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction("run", functionIndex);

  return module.encode();
}

function emitValueExpr(body: WasmFunctionBodyEncoder, value: SirValueExpr): void {
  switch (value.kind) {
    case "var":
      body.localGet(value.id);
      return;
    case "const32":
      body.i32Const(i32(value.value));
      return;
    case "nextEip":
      body.i32Const(0);
      return;
    default:
      throw new Error(`unsupported flag test value expression: ${value.kind}`);
  }
}

function v(id: number): ValueRef {
  return { kind: "var", id };
}
