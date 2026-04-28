import { ByteSink } from "./byte-sink.js";
import { encodeI32Leb128, encodeI64Leb128 } from "./leb128.js";
import { encodeMemoryImmediate, type WasmMemoryImmediate } from "./memory.js";
import { wasmOpcode, type WasmValueType } from "./types.js";

export class WasmFunctionBodyEncoder {
  readonly #instructions = new ByteSink();
  readonly #locals: WasmValueType[] = [];
  readonly #paramCount: number;
  #ended = false;

  constructor(paramCount = 0) {
    if (!Number.isInteger(paramCount) || paramCount < 0) {
      throw new RangeError(`Wasm function parameter count out of range: ${paramCount}`);
    }

    this.#paramCount = paramCount;
  }

  addLocal(type: WasmValueType): number {
    if (this.#ended) {
      throw new Error("cannot add local after Wasm function body end");
    }

    const index = this.#paramCount + this.#locals.length;
    this.#locals.push(type);
    return index;
  }

  localGet(index: number): this {
    this.#writeInstruction(wasmOpcode.localGet);
    this.#instructions.writeU32(index);
    return this;
  }

  localSet(index: number): this {
    this.#writeInstruction(wasmOpcode.localSet);
    this.#instructions.writeU32(index);
    return this;
  }

  localTee(index: number): this {
    this.#writeInstruction(wasmOpcode.localTee);
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

  i32Eqz(): this {
    this.#writeInstruction(wasmOpcode.i32Eqz);
    return this;
  }

  i32LtU(): this {
    this.#writeInstruction(wasmOpcode.i32LtU);
    return this;
  }

  i32Popcnt(): this {
    this.#writeInstruction(wasmOpcode.i32Popcnt);
    return this;
  }

  i32Add(): this {
    this.#writeInstruction(wasmOpcode.i32Add);
    return this;
  }

  i32Sub(): this {
    this.#writeInstruction(wasmOpcode.i32Sub);
    return this;
  }

  i32And(): this {
    this.#writeInstruction(wasmOpcode.i32And);
    return this;
  }

  i32Or(): this {
    this.#writeInstruction(wasmOpcode.i32Or);
    return this;
  }

  i32Xor(): this {
    this.#writeInstruction(wasmOpcode.i32Xor);
    return this;
  }

  i32Shl(): this {
    this.#writeInstruction(wasmOpcode.i32Shl);
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
    writeLocalDeclarations(body, this.#locals);
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

function writeLocalDeclarations(body: ByteSink, locals: readonly WasmValueType[]): void {
  const groups = localGroups(locals);

  body.writeVecLength(groups.length);

  for (const group of groups) {
    body.writeU32(group.count);
    body.writeByte(group.type);
  }
}

function localGroups(locals: readonly WasmValueType[]): readonly LocalGroup[] {
  const groups: LocalGroup[] = [];

  for (const type of locals) {
    const lastGroup = groups[groups.length - 1];

    if (lastGroup?.type === type) {
      groups[groups.length - 1] = { type, count: lastGroup.count + 1 };
    } else {
      groups.push({ type, count: 1 });
    }
  }

  return groups;
}

type LocalGroup = Readonly<{
  type: WasmValueType;
  count: number;
}>;
