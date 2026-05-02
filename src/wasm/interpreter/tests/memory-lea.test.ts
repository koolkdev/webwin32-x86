import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { createCpuState, type CpuState } from "../../../x86/state/cpu-state.js";
import {
  assertInterpreterStateEquals,
  readInterpreterState,
  writeInterpreterState,
  type InterpreterModuleInstance
} from "./interpreter-helpers.js";
import { startAddress } from "../../tests/helpers.js";
import { ExitReason, type DecodedExit } from "../../exit.js";
import {
  assertCompletedInstruction,
  assertSingleInstructionExit,
  instantiateWasmInterpreter,
  writeGuestBytes
} from "./support.js";

type MemoryRunResult = Readonly<{
  interpreter: InterpreterModuleInstance;
  exit: DecodedExit;
  state: CpuState;
}>;

async function executeMemoryInstruction(
  bytes: readonly number[],
  initialState: CpuState,
  setupGuest?: (view: DataView) => void
): Promise<MemoryRunResult> {
  const interpreter = await instantiateWasmInterpreter();

  writeInterpreterState(interpreter.stateView, initialState);
  writeGuestBytes(interpreter.guestView, initialState.eip, bytes);
  setupGuest?.(interpreter.guestView);

  const exit = interpreter.run(1);
  const state = readInterpreterState(interpreter.stateView);

  return { interpreter, exit, state };
}

test("executes MOV r32, [base + disp8]", async () => {
  const initialState = createCpuState({
    ebx: 0x20,
    eip: startAddress,
    instructionCount: 7
  });

  const { exit, state } = await executeMemoryInstruction(
    [0x8b, 0x43, 0x04],
    initialState,
    (guest) => guest.setUint32(0x24, 0x89ab_cdef, true)
  );

  assertSingleInstructionExit(exit);
  strictEqual(state.eax, 0x89ab_cdef);
  strictEqual(state.ebx, initialState.ebx);
  assertCompletedInstruction(state, startAddress + 3, 8);
});

test("executes MOV [base + disp8], r32", async () => {
  const initialState = createCpuState({
    eax: 0x1234_5678,
    ebx: 0x20,
    eip: startAddress,
    instructionCount: 7
  });

  const { interpreter, exit, state } = await executeMemoryInstruction([0x89, 0x43, 0x04], initialState);

  assertSingleInstructionExit(exit);
  strictEqual(interpreter.guestView.getUint32(0x24, true), 0x1234_5678);
  strictEqual(state.eax, initialState.eax);
  strictEqual(state.ebx, initialState.ebx);
  assertCompletedInstruction(state, startAddress + 3, 8);
});

test("executes MOV [base + disp8], imm32 through C7 group", async () => {
  const initialState = createCpuState({
    ebx: 0x20,
    eip: startAddress,
    instructionCount: 7
  });

  const { interpreter, exit, state } = await executeMemoryInstruction(
    [0xc7, 0x43, 0x04, 0x78, 0x56, 0x34, 0x12],
    initialState
  );

  assertSingleInstructionExit(exit);
  strictEqual(interpreter.guestView.getUint32(0x24, true), 0x1234_5678);
  strictEqual(state.ebx, initialState.ebx);
  assertCompletedInstruction(state, startAddress + 7, 8);
});

test("executes LEA r32, [base + index*scale + disp8] without reading memory", async () => {
  const initialState = createCpuState({
    ebx: 0x100,
    esi: 3,
    eip: startAddress,
    instructionCount: 7
  });

  const { exit, state } = await executeMemoryInstruction([0x8d, 0x44, 0xb3, 0x08], initialState);

  assertSingleInstructionExit(exit);
  strictEqual(state.eax, 0x114);
  strictEqual(state.ebx, initialState.ebx);
  strictEqual(state.esi, initialState.esi);
  assertCompletedInstruction(state, startAddress + 4, 8);
});

test("executes MOV r32, [disp32]", async () => {
  const initialState = createCpuState({
    eip: startAddress,
    instructionCount: 7
  });

  const { exit, state } = await executeMemoryInstruction(
    [0x8b, 0x05, 0x20, 0x00, 0x00, 0x00],
    initialState,
    (guest) => guest.setUint32(0x20, 0xc001_cafe, true)
  );

  assertSingleInstructionExit(exit);
  strictEqual(state.eax, 0xc001_cafe);
  assertCompletedInstruction(state, startAddress + 6, 8);
});

test("executes MOV r32, [index*scale + disp32] through SIB", async () => {
  const initialState = createCpuState({
    ecx: 2,
    eip: startAddress,
    instructionCount: 7
  });

  const { exit, state } = await executeMemoryInstruction(
    [0x8b, 0x04, 0x8d, 0x20, 0x00, 0x00, 0x00],
    initialState,
    (guest) => guest.setUint32(0x28, 0xfeed_beef, true)
  );

  assertSingleInstructionExit(exit);
  strictEqual(state.eax, 0xfeed_beef);
  strictEqual(state.ecx, initialState.ecx);
  assertCompletedInstruction(state, startAddress + 7, 8);
});

test("LEA m32 form rejects register ModRM", async () => {
  const initialState = createCpuState({
    eax: 0x1234_5678,
    eip: startAddress,
    instructionCount: 7
  });
  const { interpreter, exit } = await executeMemoryInstruction([0x8d, 0xc0], initialState);

  deepStrictEqual(exit, { exitReason: ExitReason.UNSUPPORTED, payload: 0x8d });
  assertInterpreterStateEquals(interpreter.stateView, initialState);
});
