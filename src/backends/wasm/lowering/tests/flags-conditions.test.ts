import { strictEqual } from "node:assert";
import { test } from "node:test";

import type { IrValueExpr } from "../../../../x86/ir/model/expressions.js";
import { createIrFlagSetOp } from "../../../../x86/ir/model/flags.js";
import type { ConditionCode, FlagProducerName, ValueRef } from "../../../../x86/ir/model/types.js";
import { x86ArithmeticFlagMask } from "../../../../x86/isa/flags.js";
import { i32 } from "../../../../x86/state/cpu-state.js";
import { WasmFunctionBodyEncoder } from "../../encoder/function-body.js";
import { WasmModuleEncoder } from "../../encoder/module.js";
import { wasmOpcode, wasmValueType } from "../../encoder/types.js";
import { wasmBodyOpcodes } from "../../tests/body-opcodes.js";
import { emitAluFlagsCondition, emitFlagProducerCondition } from "../conditions.js";
import { wasmIrLocalAluFlagsStorage } from "../alu-flags.js";
import { emitSetFlags } from "../flags.js";

const unmodeledStorageBit = 1 << 9;

test("emitSetFlags writes generated flags and normalizes arithmetic flag storage", async () => {
  const add32 = await instantiateSetFlags("add32");
  const logic32 = await instantiateSetFlags("logic32");

  strictEqual(
    add32(0xffff_ffff, 1, 0, unmodeledStorageBit | x86ArithmeticFlagMask.SF | x86ArithmeticFlagMask.OF),
    x86ArithmeticFlagMask.CF |
      x86ArithmeticFlagMask.PF |
      x86ArithmeticFlagMask.AF |
      x86ArithmeticFlagMask.ZF
  );
  strictEqual(
    logic32(0, 0, 0, unmodeledStorageBit | x86ArithmeticFlagMask.CF | x86ArithmeticFlagMask.AF | x86ArithmeticFlagMask.OF),
    x86ArithmeticFlagMask.PF | x86ArithmeticFlagMask.ZF
  );
});

test("emitSetFlags supports partial producers that preserve CF", async () => {
  const inc32 = await instantiateSetFlags("inc32");

  strictEqual(
    inc32(0xffff_ffff, 0, 0, x86ArithmeticFlagMask.CF | x86ArithmeticFlagMask.SF),
    x86ArithmeticFlagMask.CF |
      x86ArithmeticFlagMask.PF |
      x86ArithmeticFlagMask.AF |
      x86ArithmeticFlagMask.ZF
  );
});

test("emitSetFlags computes and writes only requested materialization bits", async () => {
  const add32 = await instantiateSetFlags("add32", x86ArithmeticFlagMask.ZF);
  const opcodes = wasmBodyOpcodes(encodeSetFlagsFunctionBody("add32", x86ArithmeticFlagMask.ZF).encode());

  strictEqual(
    add32(0xffff_ffff, 1, 0, x86ArithmeticFlagMask.SF),
    x86ArithmeticFlagMask.SF | x86ArithmeticFlagMask.ZF
  );
  strictEqual(opcodes.includes(wasmOpcode.i32LtU), false);
  strictEqual(opcodes.includes(wasmOpcode.i32Popcnt), false);
  strictEqual(opcodes.includes(wasmOpcode.i32ShrU), false);
});

test("emitSetFlags does not allocate an accumulator local", () => {
  const body = new WasmFunctionBodyEncoder(4);
  const aluFlags = wasmIrLocalAluFlagsStorage(body, 3);

  emitSetFlags(body, aluFlags, createIrFlagSetOp("logic32", { result: v(2) }), {
    emitValue: (value) => emitValueExpr(body, value)
  });
  body.localGet(3).end();

  strictEqual(body.encode()[0], 0);
});

test("emitAluFlagsCondition evaluates compound condition formulas from arithmetic flags", async () => {
  const le = await instantiateCondition("LE");
  const g = await instantiateCondition("G");

  strictEqual(le(x86ArithmeticFlagMask.ZF), 1);
  strictEqual(le(x86ArithmeticFlagMask.SF), 1);
  strictEqual(le(x86ArithmeticFlagMask.SF | x86ArithmeticFlagMask.OF), 0);

  strictEqual(g(0), 1);
  strictEqual(g(x86ArithmeticFlagMask.ZF), 0);
  strictEqual(g(x86ArithmeticFlagMask.SF), 0);
  strictEqual(g(x86ArithmeticFlagMask.SF | x86ArithmeticFlagMask.OF), 1);
});

test("emitFlagProducerCondition evaluates producer-backed sub32 comparisons directly", async () => {
  const eq = await instantiateFlagProducerCondition("E");
  const below = await instantiateFlagProducerCondition("B");
  const signedLess = await instantiateFlagProducerCondition("L");
  const signedGreater = await instantiateFlagProducerCondition("G");

  strictEqual(eq(5, 5), 1);
  strictEqual(eq(5, 6), 0);
  strictEqual(below(0, 1), 1);
  strictEqual(below(0xffff_ffff, 1), 0);
  strictEqual(signedLess(0xffff_ffff, 1), 1);
  strictEqual(signedGreater(0x7fff_ffff, 0xffff_ffff), 1);
});

async function instantiateSetFlags(
  producer: FlagProducerName,
  mask?: number
): Promise<(left: number, right: number, result: number, aluFlags: number) => number> {
  const module = await WebAssembly.compile(encodeSetFlagsModule(producer, mask));
  const instance = await WebAssembly.instantiate(module);
  const run = instance.exports.run;

  if (typeof run !== "function") {
    throw new Error("expected exported function 'run'");
  }

  return run as (left: number, right: number, result: number, aluFlags: number) => number;
}

function encodeSetFlagsModule(producer: FlagProducerName, mask?: number): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  const typeIndex = module.addFunctionType({
    params: [wasmValueType.i32, wasmValueType.i32, wasmValueType.i32, wasmValueType.i32],
    results: [wasmValueType.i32]
  });
  const body = encodeSetFlagsFunctionBody(producer, mask);

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction("run", functionIndex);

  return module.encode();
}

function encodeSetFlagsFunctionBody(producer: FlagProducerName, mask?: number): WasmFunctionBodyEncoder {
  const body = new WasmFunctionBodyEncoder(4);
  const aluFlags = wasmIrLocalAluFlagsStorage(body, 3);
  const inputs: Readonly<Record<string, ValueRef>> = producer === "logic32"
    ? { result: v(2) }
    : { left: v(0), right: v(1), result: v(2) };

  emitSetFlags(body, aluFlags, createIrFlagSetOp(producer, inputs), {
    emitValue: (value) => emitValueExpr(body, value)
  }, mask === undefined ? undefined : { mask });
  body.localGet(3).end();

  return body;
}

async function instantiateCondition(cc: ConditionCode): Promise<(aluFlags: number) => number> {
  const module = await WebAssembly.compile(encodeConditionModule(cc));
  const instance = await WebAssembly.instantiate(module);
  const run = instance.exports.run;

  if (typeof run !== "function") {
    throw new Error("expected exported function 'run'");
  }

  return run as (aluFlags: number) => number;
}

async function instantiateFlagProducerCondition(cc: ConditionCode): Promise<(left: number, right: number) => number> {
  const module = await WebAssembly.compile(encodeFlagProducerConditionModule(cc));
  const instance = await WebAssembly.instantiate(module);
  const run = instance.exports.run;

  if (typeof run !== "function") {
    throw new Error("expected exported function 'run'");
  }

  return run as (left: number, right: number) => number;
}

function encodeConditionModule(cc: ConditionCode): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  const typeIndex = module.addFunctionType({
    params: [wasmValueType.i32],
    results: [wasmValueType.i32]
  });
  const body = new WasmFunctionBodyEncoder(1);

  emitAluFlagsCondition(body, wasmIrLocalAluFlagsStorage(body, 0), cc);
  body.end();

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction("run", functionIndex);

  return module.encode();
}

function encodeFlagProducerConditionModule(cc: ConditionCode): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  const typeIndex = module.addFunctionType({
    params: [wasmValueType.i32, wasmValueType.i32],
    results: [wasmValueType.i32]
  });
  const body = new WasmFunctionBodyEncoder(2);

  emitFlagProducerCondition(body, {
    kind: "flagProducer.condition",
    cc,
    producer: "sub32",
    writtenMask: createIrFlagSetOp("sub32", { left: v(0), right: v(1), result: v(2) }).writtenMask,
    undefMask: 0,
    inputs: { left: v(0), right: v(1) }
  }, {
    emitValue: (value) => emitValueExpr(body, value)
  });
  body.end();

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction("run", functionIndex);

  return module.encode();
}

function emitValueExpr(body: WasmFunctionBodyEncoder, value: IrValueExpr): void {
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
