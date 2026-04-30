import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { createCpuState } from "../../../core/state/cpu-state.js";
import {
  assertInterpreterStateEquals,
  instantiateInterpreterModule,
  readInterpreterState,
  writeInterpreterState
} from "../../../test-support/wasm-interpreter.js";
import { startAddress } from "../../../test-support/wasm-codegen.js";
import { ExitReason } from "../../exit.js";
import { encodeInterpreterModule } from "../module.js";

test("executes MOV r32, r/m32 with register ModRM", async () => {
  const interpreter = await instantiateInterpreterModule(encodeInterpreterModule());
  const initialState = createCpuState({
    ebx: 0x1234_5678,
    eip: startAddress,
    instructionCount: 7
  });
  writeInterpreterState(interpreter.stateView, initialState);
  writeGuestBytes(interpreter.guestView, startAddress, [0x8b, 0xc3]);

  const exit = interpreter.run(1);
  const state = readInterpreterState(interpreter.stateView);

  deepStrictEqual(exit, { exitReason: ExitReason.INSTRUCTION_LIMIT, payload: 0 });
  strictEqual(state.eax, 0x1234_5678);
  strictEqual(state.ebx, initialState.ebx);
  strictEqual(state.eip, startAddress + 2);
  strictEqual(state.instructionCount, 8);
});

test("executes MOV r/m32, r32 with register ModRM", async () => {
  const interpreter = await instantiateInterpreterModule(encodeInterpreterModule());
  const initialState = createCpuState({
    eax: 0xaaaa_aaaa,
    ebx: 0x1234_5678,
    eip: startAddress,
    instructionCount: 7
  });
  writeInterpreterState(interpreter.stateView, initialState);
  writeGuestBytes(interpreter.guestView, startAddress, [0x89, 0xd8]);

  const exit = interpreter.run(1);
  const state = readInterpreterState(interpreter.stateView);

  deepStrictEqual(exit, { exitReason: ExitReason.INSTRUCTION_LIMIT, payload: 0 });
  strictEqual(state.eax, 0x1234_5678);
  strictEqual(state.ebx, initialState.ebx);
  strictEqual(state.eip, startAddress + 2);
  strictEqual(state.instructionCount, 8);
});

test("memory ModRM form is unsupported until memory operands are implemented", async () => {
  const interpreter = await instantiateInterpreterModule(encodeInterpreterModule());
  const initialState = createCpuState({
    eax: 0xaaaa_aaaa,
    ebx: 0x1234_5678,
    eip: startAddress,
    instructionCount: 7
  });
  writeInterpreterState(interpreter.stateView, initialState);
  writeGuestBytes(interpreter.guestView, startAddress, [0x8b, 0x03]);

  const exit = interpreter.run(1);

  deepStrictEqual(exit, { exitReason: ExitReason.UNSUPPORTED, payload: 0x8b });
  assertInterpreterStateEquals(interpreter.stateView, initialState);
});

test("truncated ModRM returns decode fault without changing architectural state", async () => {
  const interpreter = await instantiateInterpreterModule(encodeInterpreterModule());
  const eip = interpreter.guestView.byteLength - 1;
  const initialState = createCpuState({
    eax: 0xaaaa_aaaa,
    ebx: 0x1234_5678,
    eip,
    instructionCount: 7
  });
  writeInterpreterState(interpreter.stateView, initialState);
  interpreter.guestView.setUint8(eip, 0x8b);

  const exit = interpreter.run(1);

  deepStrictEqual(exit, { exitReason: ExitReason.DECODE_FAULT, payload: eip + 1 });
  assertInterpreterStateEquals(interpreter.stateView, initialState);
});

function writeGuestBytes(view: DataView, address: number, bytes: readonly number[]): void {
  for (let index = 0; index < bytes.length; index += 1) {
    view.setUint8(address + index, bytes[index] ?? 0);
  }
}
