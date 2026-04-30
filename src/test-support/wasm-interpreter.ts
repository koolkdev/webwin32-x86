import { strictEqual } from "node:assert";

import { cpuStateFields, createCpuState, type CpuState } from "../core/state/cpu-state.js";
import { wasmBlockExportName, wasmImport, stateOffset } from "../wasm/abi.js";
import { decodeExit, type DecodedExit } from "../wasm/exit.js";
import { createGuestMemory } from "./wasm-codegen.js";

export type InterpreterModuleInstance = Readonly<{
  module: WebAssembly.Module;
  instance: WebAssembly.Instance;
  stateMemory: WebAssembly.Memory;
  guestMemory: WebAssembly.Memory;
  stateView: DataView;
  guestView: DataView;
  run(fuel: number): DecodedExit;
}>;

export async function instantiateInterpreterModule(
  bytes: Uint8Array<ArrayBuffer>,
  guestMemory: WebAssembly.Memory = createGuestMemory()
): Promise<InterpreterModuleInstance> {
  const module = new WebAssembly.Module(bytes);
  const stateMemory = new WebAssembly.Memory({ initial: 1 });
  const stateView = new DataView(stateMemory.buffer);
  const guestView = new DataView(guestMemory.buffer);
  const instance = await WebAssembly.instantiate(module, {
    [wasmImport.moduleName]: {
      [wasmImport.stateMemoryName]: stateMemory,
      [wasmImport.guestMemoryName]: guestMemory
    }
  });
  const run = readExportedRun(instance);

  return {
    module,
    instance,
    stateMemory,
    guestMemory,
    stateView,
    guestView,
    run: (fuel) => decodeExit(run(fuel))
  };
}

export function writeInterpreterState(view: DataView, state: CpuState): void {
  for (const field of cpuStateFields) {
    view.setUint32(stateOffset[field], state[field], true);
  }
}

export function readInterpreterState(view: DataView): CpuState {
  const state = createCpuState();

  for (const field of cpuStateFields) {
    state[field] = view.getUint32(stateOffset[field], true);
  }

  return state;
}

export function assertInterpreterStateEquals(view: DataView, state: CpuState): void {
  for (const field of cpuStateFields) {
    strictEqual(view.getUint32(stateOffset[field], true), state[field]);
  }
}

function readExportedRun(instance: WebAssembly.Instance): (fuel: number) => bigint {
  const value = instance.exports[wasmBlockExportName];

  if (typeof value !== "function") {
    throw new Error(`expected exported function '${wasmBlockExportName}'`);
  }

  return value as (fuel: number) => bigint;
}
