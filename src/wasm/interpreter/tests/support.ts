import { deepStrictEqual, strictEqual } from "node:assert";

import type { CpuState } from "../../../core/state/cpu-state.js";
import {
  instantiateInterpreterModule,
  readInterpreterState,
  writeInterpreterState,
  type InterpreterModuleInstance
} from "../../../test-support/wasm-interpreter.js";
import { ExitReason, type DecodedExit } from "../../exit.js";
import { encodeInterpreterModule } from "../module.js";

export type ExecutedInstruction = Readonly<{
  exit: DecodedExit;
  state: CpuState;
}>;

export async function instantiateWasmInterpreter(): Promise<InterpreterModuleInstance> {
  return instantiateInterpreterModule(encodeInterpreterModule());
}

export async function executeInstruction(
  bytes: readonly number[],
  initialState: CpuState
): Promise<ExecutedInstruction> {
  const interpreter = await instantiateWasmInterpreter();

  writeInterpreterState(interpreter.stateView, initialState);
  writeGuestBytes(interpreter.guestView, initialState.eip, bytes);

  const exit = interpreter.run(1);
  const state = readInterpreterState(interpreter.stateView);

  return { exit, state };
}

export function writeGuestBytes(view: DataView, address: number, bytes: readonly number[]): void {
  for (let index = 0; index < bytes.length; index += 1) {
    view.setUint8(address + index, bytes[index] ?? 0);
  }
}

export function assertSingleInstructionExit(exit: DecodedExit): void {
  deepStrictEqual(exit, { exitReason: ExitReason.INSTRUCTION_LIMIT, payload: 0 });
}

export function assertCompletedInstruction(
  state: CpuState,
  expectedEip: number,
  expectedInstructionCount: number
): void {
  strictEqual(state.eip, expectedEip);
  strictEqual(state.instructionCount, expectedInstructionCount);
}
