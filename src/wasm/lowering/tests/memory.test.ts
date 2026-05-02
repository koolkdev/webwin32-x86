import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { wasmImport, wasmMemoryIndex } from "../../abi.js";
import { WasmFunctionBodyEncoder } from "../../encoder/function-body.js";
import { WasmModuleEncoder } from "../../encoder/module.js";
import { wasmValueType } from "../../encoder/types.js";
import { decodeExit, ExitReason } from "../../exit.js";
import { emitWasmIrExitFromI32Stack, type WasmIrExitTarget } from "../exit.js";
import {
  emitWasmIrLoadGuestU32,
  emitWasmIrLoadGuestU32FromStack,
  emitWasmIrStoreGuestU32
} from "../memory.js";

test("guest u32 load helpers return values and fault before out-of-bounds reads", async () => {
  for (const mode of ["local", "stack"] as const) {
    const { run, guestView } = await instantiateMemoryModule(encodeGuestLoadModule(mode));

    guestView.setUint32(12, 0x1234_5678, true);

    deepStrictEqual(decodeExit(run(12)), {
      exitReason: ExitReason.FALLTHROUGH,
      payload: 0x1234_5678
    });
    deepStrictEqual(decodeExit(run(0x1_0000)), {
      exitReason: ExitReason.MEMORY_READ_FAULT,
      payload: 0x1_0000
    });
  }
});

test("guest u32 store helper writes values and reports write faults", async () => {
  const { run, guestView } = await instantiateMemoryModule(encodeGuestStoreModule());

  deepStrictEqual(decodeExit(run(16, 0x89ab_cdef)), {
    exitReason: ExitReason.FALLTHROUGH,
    payload: 0
  });
  strictEqual(guestView.getUint32(16, true), 0x89ab_cdef);

  deepStrictEqual(decodeExit(run(0x1_0000, 0)), {
    exitReason: ExitReason.MEMORY_WRITE_FAULT,
    payload: 0x1_0000
  });
});

async function instantiateMemoryModule(bytes: Uint8Array<ArrayBuffer>): Promise<{
  run: (...args: number[]) => bigint;
  guestView: DataView;
}> {
  const module = await WebAssembly.compile(bytes);
  const stateMemory = new WebAssembly.Memory({ initial: 1 });
  const guestMemory = new WebAssembly.Memory({ initial: 1 });
  const instance = await WebAssembly.instantiate(module, {
    [wasmImport.moduleName]: {
      [wasmImport.stateMemoryName]: stateMemory,
      [wasmImport.guestMemoryName]: guestMemory
    }
  });
  const run = instance.exports.run;

  if (typeof run !== "function") {
    throw new Error("expected exported function 'run'");
  }

  return {
    run: (...args) => {
      const result = (run as (...callArgs: number[]) => unknown)(...args);

      if (typeof result !== "bigint") {
        throw new Error(`expected bigint result, got ${typeof result}`);
      }

      return result;
    },
    guestView: new DataView(guestMemory.buffer)
  };
}

function encodeGuestLoadModule(mode: "local" | "stack"): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();

  importStateAndGuestMemory(module);

  const typeIndex = module.addFunctionType({
    params: [wasmValueType.i32],
    results: [wasmValueType.i64]
  });
  const body = new WasmFunctionBodyEncoder(1);
  const exitLocal = body.addLocal(wasmValueType.i64);
  const exit: WasmIrExitTarget = { exitLocal, exitLabelDepth: 0 };

  body.block();
  if (mode === "local") {
    emitWasmIrLoadGuestU32({ body, exit }, 0);
  } else {
    body.localGet(0);
    emitWasmIrLoadGuestU32FromStack({ body, exit }, 0);
  }
  emitWasmIrExitFromI32Stack(body, exit, ExitReason.FALLTHROUGH);
  body.endBlock();
  body.localGet(exitLocal).end();

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction("run", functionIndex);

  return module.encode();
}

function encodeGuestStoreModule(): Uint8Array<ArrayBuffer> {
  const module = new WasmModuleEncoder();

  importStateAndGuestMemory(module);

  const typeIndex = module.addFunctionType({
    params: [wasmValueType.i32, wasmValueType.i32],
    results: [wasmValueType.i64]
  });
  const body = new WasmFunctionBodyEncoder(2);
  const exitLocal = body.addLocal(wasmValueType.i64);
  const exit: WasmIrExitTarget = { exitLocal, exitLabelDepth: 0 };

  body.block();
  emitWasmIrStoreGuestU32({ body, exit }, 0, 1);
  body.i32Const(0);
  emitWasmIrExitFromI32Stack(body, exit, ExitReason.FALLTHROUGH);
  body.endBlock();
  body.localGet(exitLocal).end();

  const functionIndex = module.addFunction(typeIndex, body);
  module.exportFunction("run", functionIndex);

  return module.encode();
}

function importStateAndGuestMemory(module: WasmModuleEncoder): void {
  const stateMemoryIndex = module.importMemory(wasmImport.moduleName, wasmImport.stateMemoryName, { minPages: 1 });
  const guestMemoryIndex = module.importMemory(wasmImport.moduleName, wasmImport.guestMemoryName, { minPages: 1 });

  if (stateMemoryIndex !== wasmMemoryIndex.state || guestMemoryIndex !== wasmMemoryIndex.guest) {
    throw new Error("unexpected Wasm memory import order");
  }
}
