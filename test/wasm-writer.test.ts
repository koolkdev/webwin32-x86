import { match, ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { WasmFunctionBodyEncoder } from "../src/wasm/encoder/function-body.js";
import { WasmModuleEncoder } from "../src/wasm/encoder/module.js";
import { wasmValueType } from "../src/wasm/encoder/types.js";

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
