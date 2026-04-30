import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { WasmFunctionBodyEncoder } from "../../src/wasm/encoder/function-body.js";
import { WasmModuleEncoder } from "../../src/wasm/encoder/module.js";
import { wasmValueType } from "../../src/wasm/encoder/types.js";
import { decodeExit, encodeExit, ExitReason, type DecodedExit } from "../../src/wasm/exit.js";

const fixtures: readonly ExitFixture[] = [
  {
    name: "fallthrough_exit_decodes",
    exitReason: ExitReason.FALLTHROUGH,
    payload: 0x1005
  },
  {
    name: "host_trap_exit_decodes",
    exitReason: ExitReason.HOST_TRAP,
    payload: 0xcd
  },
  {
    name: "unsupported_exit_decodes",
    exitReason: ExitReason.UNSUPPORTED,
    payload: 0x1000
  },
  {
    name: "decode_fault_exit_decodes",
    exitReason: ExitReason.DECODE_FAULT,
    payload: 0x1000
  },
  {
    name: "memory_read_fault_exit_decodes",
    exitReason: ExitReason.MEMORY_READ_FAULT,
    payload: 0x3e
  },
  {
    name: "memory_write_fault_exit_decodes",
    exitReason: ExitReason.MEMORY_WRITE_FAULT,
    payload: 0x3e
  },
  {
    name: "roundtrip_high_payload_bit",
    exitReason: ExitReason.FALLTHROUGH,
    payload: 0xffff_ffff
  }
];

for (const fixture of fixtures) {
  test(fixture.name, async () => {
    const expected = {
      exitReason: fixture.exitReason,
      payload: fixture.payload
    };
    const encoded = encodeExit(fixture.exitReason, fixture.payload);
    const wasmEncoded = await runExitResult(fixture.exitReason, fixture.payload);

    deepStrictEqual(decodeExit(encoded), expected);
    strictEqual(wasmEncoded, encoded);
    deepStrictEqual(decodeExit(wasmEncoded), expected);
  });
}

async function runExitResult(exitReason: ExitReason, payload: number): Promise<bigint> {
  const module = new WasmModuleEncoder();
  const typeIndex = module.addFunctionType({
    params: [],
    results: [wasmValueType.i64]
  });
  const body = new WasmFunctionBodyEncoder()
    .i64Const(encodeExit(exitReason, payload))
    .end();
  const functionIndex = module.addFunction(typeIndex, body);

  module.exportFunction("exitResult", functionIndex);

  const instance = await WebAssembly.instantiate(await WebAssembly.compile(module.encode()));
  const exitResult = instance.exports.exitResult;

  if (typeof exitResult !== "function") {
    throw new Error("expected exported function 'exitResult'");
  }

  const result: unknown = exitResult();

  if (typeof result !== "bigint") {
    throw new Error(`expected bigint exit result, got ${typeof result}`);
  }

  return result;
}

type ExitFixture = DecodedExit & Readonly<{
  name: string;
}>;
