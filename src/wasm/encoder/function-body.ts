import { ByteSink } from "./byte-sink.js";
import { encodeI32Leb128, encodeI64Leb128 } from "./leb128.js";
import { encodeMemoryImmediate, type WasmMemoryImmediate } from "./memory.js";
import { wasmOpcode } from "./types.js";

export class WasmFunctionBodyEncoder {
  readonly #instructions = new ByteSink();
  #ended = false;

  localGet(index: number): this {
    this.#writeInstruction(wasmOpcode.localGet);
    this.#instructions.writeU32(index);
    return this;
  }

  i32Const(value: number): this {
    this.#writeInstruction(wasmOpcode.i32Const);
    this.#instructions.writeBytes(encodeI32Leb128(value));
    return this;
  }

  i64Const(value: bigint): this {
    this.#writeInstruction(wasmOpcode.i64Const);
    this.#instructions.writeBytes(encodeI64Leb128(value));
    return this;
  }

  i32Add(): this {
    this.#writeInstruction(wasmOpcode.i32Add);
    return this;
  }

  i32Load(immediate: WasmMemoryImmediate): this {
    this.#writeInstruction(wasmOpcode.i32Load);
    this.#instructions.writeBytes(encodeMemoryImmediate(immediate));
    return this;
  }

  i32Store(immediate: WasmMemoryImmediate): this {
    this.#writeInstruction(wasmOpcode.i32Store);
    this.#instructions.writeBytes(encodeMemoryImmediate(immediate));
    return this;
  }

  end(): this {
    this.#writeInstruction(wasmOpcode.end);
    this.#ended = true;
    return this;
  }

  encode(): Uint8Array<ArrayBuffer> {
    if (!this.#ended) {
      throw new Error("Wasm function body must end with end opcode");
    }

    const body = new ByteSink();
    body.writeVecLength(0);
    body.writeBytes(this.#instructions.toBytes());
    return body.toBytes();
  }

  #writeInstruction(opcode: number): void {
    if (this.#ended) {
      throw new Error("cannot write after Wasm function body end");
    }

    this.#instructions.writeByte(opcode);
  }
}
