import { ByteSink } from "./byte-sink.js";
import { encodeI64Leb128 } from "./leb128.js";
import { wasmOpcode } from "./types.js";

export class WasmFunctionBodyEncoder {
  readonly #instructions = new ByteSink();
  #ended = false;

  i64Const(value: bigint): this {
    this.#writeInstruction(wasmOpcode.i64Const);
    this.#instructions.writeBytes(encodeI64Leb128(value));
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
