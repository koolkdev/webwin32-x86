import { match, ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { wasmBranchHint, WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { WasmModuleEncoder } from "#backends/wasm/encoder/module.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";

test("constant i64 function compiles", async () => {
  const bytes = encodeConstantI64TestModule("constant", 0x0006_0000_1234_5678n);

  const module = await WebAssembly.compile(bytes);

  ok(module instanceof WebAssembly.Module);
});

test("constant i64 function returns bigint", async () => {
  const expected = 0x0006_0000_1234_5678n;
  const bytes = encodeConstantI64TestModule("constant", expected);

  const module = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(module);
  const constant = instance.exports.constant;

  if (typeof constant !== "function") {
    throw new Error("expected exported function 'constant'");
  }

  const result: unknown = constant();

  strictEqual(typeof result, "bigint");
  strictEqual(result, expected);
});

test("bad module bytes fail cleanly", async () => {
  const result = await compileForTest(new Uint8Array([0x00, 0x61, 0x73, 0x6d]));

  strictEqual(result.ok, false);
  match(result.message, /WebAssembly\.compile|expected|section|version|short|magic/i);
});

test("branch hint metadata section compiles", async () => {
  const module = await WebAssembly.compile(encodeHintedIfTestModule());
  const sections = WebAssembly.Module.customSections(module, "metadata.code.branch_hint");

  strictEqual(sections.length, 1);
});

test("br_table dispatch compiles and branches by i32 selector", async () => {
  const module = await WebAssembly.compile(encodeBrTableTestModule());
  const instance = await WebAssembly.instantiate(module);
  const select = instance.exports.select;

  if (typeof select !== "function") {
    throw new Error("expected exported function 'select'");
  }

  strictEqual(select(0), 10);
  strictEqual(select(1), 20);
  strictEqual(select(2), 30);
});

test("typed if expression compiles and returns branch values", async () => {
  const module = await WebAssembly.compile(encodeTypedIfTestModule());
  const instance = await WebAssembly.instantiate(module);
  const select = instance.exports.select;

  if (typeof select !== "function") {
    throw new Error("expected exported function 'select'");
  }

  strictEqual(select(0), 20);
  strictEqual(select(1), 10);
});

type CompileResult =
  | Readonly<{ ok: true; module: WebAssembly.Module }>
  | Readonly<{ ok: false; message: string }>;

async function compileForTest(bytes: Uint8Array<ArrayBuffer>): Promise<CompileResult> {
  try {
    return {
      ok: true,
      module: await WebAssembly.compile(bytes)
    };
  } catch (error: unknown) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

function encodeConstantI64TestModule(exportName: string, value: bigint): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  const typeIndex = module.addFunctionType({
    params: [],
    results: [wasmValueType.i64]
  });
  const body = new WasmFunctionBodyEncoder().i64Const(value).end();
  const functionIndex = module.addFunction(typeIndex, body);

  module.exportFunction(exportName, functionIndex);

  return module.encode();
}

function encodeHintedIfTestModule(): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  const typeIndex = module.addFunctionType({
    params: [],
    results: [wasmValueType.i32]
  });
  const body = new WasmFunctionBodyEncoder()
    .i32Const(0)
    .ifBlock(wasmBranchHint.unlikely)
    .endBlock()
    .i32Const(1)
    .end();
  const functionIndex = module.addFunction(typeIndex, body);

  module.exportFunction("hintedIf", functionIndex);

  return module.encode();
}

function encodeBrTableTestModule(): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  const typeIndex = module.addFunctionType({
    params: [wasmValueType.i32],
    results: [wasmValueType.i32]
  });
  const body = new WasmFunctionBodyEncoder(1)
    .block()
    .block()
    .block()
    .localGet(0)
    .brTable([1, 0], 2)
    .endBlock()
    .i32Const(20)
    .returnFromFunction()
    .endBlock()
    .i32Const(10)
    .returnFromFunction()
    .endBlock()
    .i32Const(30)
    .end();
  const functionIndex = module.addFunction(typeIndex, body);

  module.exportFunction("select", functionIndex);

  return module.encode();
}

function encodeTypedIfTestModule(): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  const typeIndex = module.addFunctionType({
    params: [wasmValueType.i32],
    results: [wasmValueType.i32]
  });
  const body = new WasmFunctionBodyEncoder(1)
    .localGet(0)
    .ifBlock(undefined, wasmValueType.i32)
    .i32Const(10)
    .elseBlock()
    .i32Const(20)
    .endBlock()
    .end();
  const functionIndex = module.addFunction(typeIndex, body);

  module.exportFunction("select", functionIndex);

  return module.encode();
}
