import { deepStrictEqual, strictEqual } from "node:assert";

import type { CpuState } from "../../../x86/state/cpu-state.js";
import {
  instantiateInterpreterCompiledModule,
  readInterpreterState,
  writeInterpreterState,
  type InterpreterModuleInstance
} from "./interpreter-helpers.js";
import { ExitReason, type DecodedExit } from "../../exit.js";
import { readInterpreterWasmArtifact } from "../artifact.js";

export type ExecutedInstruction = Readonly<{
  exit: DecodedExit;
  state: CpuState;
}>;

let interpreterModule: WebAssembly.Module | undefined;

export async function instantiateWasmInterpreter(): Promise<InterpreterModuleInstance> {
  interpreterModule ??= new WebAssembly.Module(readInterpreterWasmArtifact());
  return instantiateInterpreterCompiledModule(interpreterModule);
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
