import {
  ArrayBufferGuestMemory,
  type GuestMemory,
  type MemoryReadResult,
  type MemoryWriteResult
} from "../../../memory/guest-memory.js";
import type { CpuState } from "../../../state/cpu-state.js";
import { runIsaInterpreter } from "../interpreter.js";
import { startAddress } from "../../decoder/tests/helpers.js";

export { bytes, decodeBytes, ok, startAddress } from "../../decoder/tests/helpers.js";

export type RunIsaBytesOptions = Readonly<{
  baseAddress?: number;
  instructionLimit?: number;
  memory?: GuestMemory;
}>;

export function runIsaBytes(
  state: CpuState,
  values: ArrayLike<number>,
  options: RunIsaBytesOptions = {}
) {
  const baseAddress = options.baseAddress ?? startAddress;
  const memory = new ProgramGuestMemory(
    values,
    baseAddress,
    options.memory ?? new ArrayBufferGuestMemory(0)
  );

  return runIsaInterpreter(
    state,
    memory,
    options.instructionLimit === undefined ? {} : { instructionLimit: options.instructionLimit }
  );
}

class ProgramGuestMemory implements GuestMemory {
  readonly #program: Uint8Array<ArrayBuffer>;

  constructor(
    values: ArrayLike<number>,
    readonly baseAddress: number,
    readonly dataMemory: GuestMemory
  ) {
    this.#program = Uint8Array.from(values);
  }

  get byteLength(): number {
    return Math.max(this.dataMemory.byteLength, this.baseAddress + this.#program.length);
  }

  readU8(address: number): MemoryReadResult {
    const offset = address - this.baseAddress;

    if (offset >= 0 && offset < this.#program.length) {
      return { ok: true, value: this.#program[offset] ?? 0 };
    }

    return this.dataMemory.readU8(address);
  }

  readU16(address: number): MemoryReadResult {
    if (this.#containsProgramRange(address, 2)) {
      return {
        ok: true,
        value: (this.#program[address - this.baseAddress] ?? 0) |
          ((this.#program[address - this.baseAddress + 1] ?? 0) << 8)
      };
    }

    return this.dataMemory.readU16(address);
  }

  readU32(address: number): MemoryReadResult {
    if (this.#containsProgramRange(address, 4)) {
      const offset = address - this.baseAddress;

      return {
        ok: true,
        value: (
          (this.#program[offset] ?? 0) |
          ((this.#program[offset + 1] ?? 0) << 8) |
          ((this.#program[offset + 2] ?? 0) << 16) |
          ((this.#program[offset + 3] ?? 0) << 24)
        ) >>> 0
      };
    }

    return this.dataMemory.readU32(address);
  }

  writeU8(address: number, value: number): MemoryWriteResult {
    const offset = address - this.baseAddress;

    if (offset >= 0 && offset < this.#program.length) {
      this.#program[offset] = value & 0xff;
      return { ok: true };
    }

    return this.dataMemory.writeU8(address, value);
  }

  writeU16(address: number, value: number): MemoryWriteResult {
    if (this.#containsProgramRange(address, 2)) {
      this.#program[address - this.baseAddress] = value & 0xff;
      this.#program[address - this.baseAddress + 1] = (value >>> 8) & 0xff;
      return { ok: true };
    }

    return this.dataMemory.writeU16(address, value);
  }

  writeU32(address: number, value: number): MemoryWriteResult {
    if (this.#containsProgramRange(address, 4)) {
      const offset = address - this.baseAddress;

      this.#program[offset] = value & 0xff;
      this.#program[offset + 1] = (value >>> 8) & 0xff;
      this.#program[offset + 2] = (value >>> 16) & 0xff;
      this.#program[offset + 3] = (value >>> 24) & 0xff;
      return { ok: true };
    }

    return this.dataMemory.writeU32(address, value);
  }

  #containsProgramRange(address: number, size: number): boolean {
    const offset = address - this.baseAddress;

    return offset >= 0 && offset + size <= this.#program.length;
  }
}
