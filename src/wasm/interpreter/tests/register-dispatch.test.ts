import { strictEqual } from "node:assert";
import { test } from "node:test";

import { reg32, type Reg32 } from "../../../arch/x86/isa/types.js";
import { WasmFunctionBodyEncoder } from "../../encoder/function-body.js";
import { WasmModuleEncoder } from "../../encoder/module.js";
import { wasmValueType } from "../../encoder/types.js";
import { emitLoadReg32ByIndex } from "../register-dispatch.js";

test("register dispatch can leave the selected register value on the stack", async () => {
  const module = await WebAssembly.compile(encodeRegisterDispatchTestModule());
  const instance = await WebAssembly.instantiate(module);
  const select = instance.exports.select;

  if (typeof select !== "function") {
    throw new Error("expected exported function 'select'");
  }

  strictEqual(select(0, 10, 20, 30, 40, 50, 60, 70, 80), 10);
  strictEqual(select(3, 10, 20, 30, 40, 50, 60, 70, 80), 40);
  strictEqual(select(7, 10, 20, 30, 40, 50, 60, 70, 80), 80);
  strictEqual(select(99, 10, 20, 30, 40, 50, 60, 70, 80), 0);
});

function encodeRegisterDispatchTestModule(): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();
  const typeIndex = module.addFunctionType({
    params: new Array(1 + reg32.length).fill(wasmValueType.i32),
    results: [wasmValueType.i32]
  });
  const body = new WasmFunctionBodyEncoder(1 + reg32.length);
  const regs = Object.fromEntries(reg32.map((reg, index) => [reg, index + 1])) as Record<Reg32, number>;

  emitLoadReg32ByIndex(body, regs, () => {
    body.localGet(0);
  });
  body.end();

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction("select", functionIndex);

  return module.encode();
}
