import {
  createCpuState,
  cpuStateFields,
  STATE_BYTE_LENGTH,
  u32,
  type CpuState,
  type CpuStateField
} from "../../core/state/cpu-state.js";
import { stateOffset } from "../../wasm/abi.js";

export class WasmCpuState {
  constructor(readonly memory: WebAssembly.Memory) {
    if (memory.buffer.byteLength < STATE_BYTE_LENGTH) {
      throw new RangeError(`state memory is too small: ${memory.buffer.byteLength} < ${STATE_BYTE_LENGTH}`);
    }
  }

  read(field: CpuStateField): number {
    return this.#view().getUint32(stateOffset[field], true);
  }

  write(field: CpuStateField, value: number): void {
    this.#view().setUint32(stateOffset[field], u32(value), true);
  }

  load(state: Partial<CpuState>): void {
    const normalized = createCpuState(state);

    for (const field of cpuStateFields) {
      this.write(field, normalized[field]);
    }
  }

  snapshot(): CpuState {
    const state = createCpuState();

    for (const field of cpuStateFields) {
      state[field] = this.read(field);
    }

    return state;
  }

  get eip(): number {
    return this.read("eip");
  }

  set eip(value: number) {
    this.write("eip", value);
  }

  get instructionCount(): number {
    return this.read("instructionCount");
  }

  get stopReason(): number {
    return this.read("stopReason");
  }

  #view(): DataView<ArrayBuffer> {
    return new DataView(this.memory.buffer);
  }
}
