import { cpuStateFields, u32, type CpuState } from "../../core/state/cpu-state.js";
import { wasmBlockExportName, wasmImport, stateOffset } from "../abi.js";
import { decodeExit, type DecodedExit } from "../exit.js";
import { readInterpreterWasmArtifact } from "./artifact.js";

let compiledInterpreterModule: WebAssembly.Module | undefined;

export class WasmInterpreterRuntime {
  readonly guestMemory: WebAssembly.Memory;
  readonly stateMemory = new WebAssembly.Memory({ initial: 1 });
  readonly stateView = new DataView(this.stateMemory.buffer);
  readonly #run: (fuel: number) => bigint;

  constructor(guestMemory: WebAssembly.Memory) {
    this.guestMemory = guestMemory;

    const instance = new WebAssembly.Instance(compiledModule(), {
      [wasmImport.moduleName]: {
        [wasmImport.stateMemoryName]: this.stateMemory,
        [wasmImport.guestMemoryName]: this.guestMemory
      }
    });

    this.#run = readRunExport(instance);
  }

  run(fuel: number): DecodedExit {
    return decodeExit(this.#run(fuel));
  }

  copyStateToWasm(state: CpuState): void {
    for (const field of cpuStateFields) {
      this.stateView.setUint32(stateOffset[field], state[field], true);
    }
  }

  copyStateFromWasm(state: CpuState): void {
    for (const field of cpuStateFields) {
      state[field] = u32(this.stateView.getUint32(stateOffset[field], true));
    }
  }
}

function compiledModule(): WebAssembly.Module {
  compiledInterpreterModule ??= new WebAssembly.Module(readInterpreterWasmArtifact());

  return compiledInterpreterModule;
}

function readRunExport(instance: WebAssembly.Instance): (fuel: number) => bigint {
  const exported = instance.exports[wasmBlockExportName];

  if (typeof exported !== "function") {
    throw new Error(`expected exported function '${wasmBlockExportName}'`);
  }

  return exported as (fuel: number) => bigint;
}
