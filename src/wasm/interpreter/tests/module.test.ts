import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { createCpuState } from "../../../core/state/cpu-state.js";
import {
  assertInterpreterStateEquals,
  instantiateInterpreterModule,
  writeInterpreterState
} from "../../../test-support/wasm-interpreter.js";
import { assertMemoryImports, startAddress } from "../../../test-support/wasm-codegen.js";
import { wasmImport } from "../../abi.js";
import { ExitReason } from "../../exit.js";
import { encodeInterpreterModule } from "../module.js";

test("imports state and guest memories in ABI order", () => {
  const module = new WebAssembly.Module(encodeInterpreterModule());

  assertMemoryImports(module);
});

test("exports run(fuel) -> i64", async () => {
  const interpreter = await instantiateInterpreterModule(encodeInterpreterModule());
  const exportedRun = interpreter.instance.exports.run;

  strictEqual(typeof exportedRun, "function");
  strictEqual(
    WebAssembly.Module.exports(interpreter.module).some((entry) => entry.kind === "function" && entry.name === "run"),
    true
  );
});

test("fuel zero returns instruction-limit exit without changing architectural state", async () => {
  const interpreter = await instantiateInterpreterModule(encodeInterpreterModule());
  const initialState = createCpuState({
    eax: 0x1122_3344,
    ebx: 0x5566_7788,
    eip: startAddress,
    instructionCount: 7
  });
  writeInterpreterState(interpreter.stateView, initialState);

  const exit = interpreter.run(0);

  deepStrictEqual(exit, { exitReason: ExitReason.INSTRUCTION_LIMIT, payload: 0 });
  assertInterpreterStateEquals(interpreter.stateView, initialState);
});

test("unsupported byte returns unsupported exit without changing architectural state", async () => {
  const interpreter = await instantiateInterpreterModule(encodeInterpreterModule());
  const initialState = createCpuState({
    eax: 0x1122_3344,
    ebx: 0x5566_7788,
    eip: startAddress,
    instructionCount: 7
  });
  writeInterpreterState(interpreter.stateView, initialState);
  interpreter.guestView.setUint8(startAddress, 0x62);

  const exit = interpreter.run(1);

  deepStrictEqual(exit, { exitReason: ExitReason.UNSUPPORTED, payload: 0x62 });
  assertInterpreterStateEquals(interpreter.stateView, initialState);
});

test("requires both ABI memories when instantiating", async () => {
  const module = new WebAssembly.Module(encodeInterpreterModule());
  const stateMemory = new WebAssembly.Memory({ initial: 1 });

  await WebAssembly.instantiate(module, {
    [wasmImport.moduleName]: {
      [wasmImport.stateMemoryName]: stateMemory
    }
  }).then(
    () => {
      throw new Error("expected instantiation failure");
    },
    (error: unknown) => {
      strictEqual(error instanceof WebAssembly.LinkError, true);
    }
  );
});
