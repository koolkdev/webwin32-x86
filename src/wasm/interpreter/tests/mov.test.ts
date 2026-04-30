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

test("executes MOV eax, imm32", async () => {
  const interpreter = await instantiateInterpreterModule(encodeInterpreterModule());
  const initialState = createCpuState({
    eip: startAddress,
    instructionCount: 7
  });
  writeInterpreterState(interpreter.stateView, initialState);
  writeGuestBytes(interpreter.guestView, startAddress, [0xb8, 0x78, 0x56, 0x34, 0x12]);

  const exit = interpreter.run(1);
  const state = readInterpreterState(interpreter.stateView);

  deepStrictEqual(exit, { exitReason: ExitReason.INSTRUCTION_LIMIT, payload: 0 });
  strictEqual(state.eax, 0x1234_5678);
  strictEqual(state.eip, startAddress + 5);
  strictEqual(state.instructionCount, 8);
  strictEqual(state.ebx, initialState.ebx);
});

test("executes MOV edi, imm32 through opcode register low bits", async () => {
  const interpreter = await instantiateInterpreterModule(encodeInterpreterModule());
  const initialState = createCpuState({
    eax: 0x1122_3344,
    eip: startAddress,
    instructionCount: 7
  });
  writeInterpreterState(interpreter.stateView, initialState);
  writeGuestBytes(interpreter.guestView, startAddress, [0xbf, 0x01, 0x00, 0x00, 0x00]);

  const exit = interpreter.run(1);
  const state = readInterpreterState(interpreter.stateView);

  deepStrictEqual(exit, { exitReason: ExitReason.INSTRUCTION_LIMIT, payload: 0 });
  strictEqual(state.edi, 1);
  strictEqual(state.eax, initialState.eax);
  strictEqual(state.eip, startAddress + 5);
  strictEqual(state.instructionCount, 8);
});

test("truncated MOV r32, imm32 returns decode fault without changing architectural state", async () => {
  const interpreter = await instantiateInterpreterModule(encodeInterpreterModule());
  const eip = interpreter.guestView.byteLength - 3;
  const initialState = createCpuState({
    eax: 0x1122_3344,
    eip,
    instructionCount: 7
  });
  writeInterpreterState(interpreter.stateView, initialState);
  writeGuestBytes(interpreter.guestView, eip, [0xb8, 0x01, 0x02]);

  const exit = interpreter.run(1);

  deepStrictEqual(exit, { exitReason: ExitReason.DECODE_FAULT, payload: eip + 1 });
  assertInterpreterStateEquals(interpreter.stateView, initialState);
});

function writeGuestBytes(view: DataView, address: number, bytes: readonly number[]): void {
  for (let index = 0; index < bytes.length; index += 1) {
    view.setUint8(address + index, bytes[index] ?? 0);
  }
}
