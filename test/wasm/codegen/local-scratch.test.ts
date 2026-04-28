import { strictEqual, throws } from "node:assert";
import { test } from "node:test";

import { decodeBytes } from "../../../src/test-support/wasm-codegen.js";
import { WasmBlockCompiler } from "../../../src/wasm/codegen/block.js";
import { WasmLocalScratchAllocator } from "../../../src/wasm/codegen/local-scratch.js";
import { WasmFunctionBodyEncoder } from "../../../src/wasm/encoder/function-body.js";
import { wasmValueType } from "../../../src/wasm/encoder/types.js";

test("wasm_codegen_scratch_allocator_reuses_released_i32_local", () => {
  const body = new WasmFunctionBodyEncoder(1);
  const scratch = new WasmLocalScratchAllocator(body);
  const first = scratch.allocLocal(wasmValueType.i32);

  scratch.freeLocal(first);

  const second = scratch.allocLocal(wasmValueType.i32);

  strictEqual(second, first);
});

test("wasm_codegen_scratch_allocator_keeps_value_type_pools_separate", () => {
  const body = new WasmFunctionBodyEncoder(1);
  const scratch = new WasmLocalScratchAllocator(body);
  const i32Local = scratch.allocLocal(wasmValueType.i32);
  const i64Local = scratch.allocLocal(wasmValueType.i64);

  scratch.freeLocal(i32Local);
  scratch.freeLocal(i64Local);

  const reusedI64 = scratch.allocLocal(wasmValueType.i64);
  const reusedI32 = scratch.allocLocal(wasmValueType.i32);

  strictEqual(reusedI64, i64Local);
  strictEqual(reusedI32, i32Local);
});

test("wasm_codegen_scratch_allocator_rejects_invalid_local_release", () => {
  const body = new WasmFunctionBodyEncoder(1);
  const scratch = new WasmLocalScratchAllocator(body);
  const permanent = body.addLocal(wasmValueType.i32);
  const temporary = scratch.allocLocal(wasmValueType.i32);

  throws(() => scratch.freeLocal(permanent), /non-scratch local/);

  scratch.freeLocal(temporary);

  throws(() => scratch.freeLocal(temporary), /already free/);
});

test("wasm_codegen_scratch_allocator_asserts_clear_state", () => {
  const body = new WasmFunctionBodyEncoder(1);
  const scratch = new WasmLocalScratchAllocator(body);
  const temporary = scratch.allocLocal(wasmValueType.i32);

  throws(() => scratch.assertClear(), /still in use/);

  scratch.freeLocal(temporary);
  scratch.assertClear();
});

test("wasm_codegen_declares_fewer_scratch_locals_for_repeated_ops", () => {
  const bytes = new WasmBlockCompiler().encodeInstructions(decodeBytes([
    0xb8, 0x01, 0x00, 0x00, 0x00,
    0xb9, 0x02, 0x00, 0x00, 0x00,
    0xba, 0x03, 0x00, 0x00, 0x00,
    0xbb, 0x04, 0x00, 0x00, 0x00
  ]));

  strictEqual(firstFunctionLocalCount(bytes), 1);
});

function firstFunctionLocalCount(moduleBytes: Uint8Array): number {
  let offset = 8;

  while (offset < moduleBytes.byteLength) {
    const sectionId = moduleBytes[offset];
    offset += 1;

    const sectionSize = readU32Leb(moduleBytes, offset);
    offset = sectionSize.nextOffset;

    if (sectionId !== 10) {
      offset += sectionSize.value;
      continue;
    }

    const functionCount = readU32Leb(moduleBytes, offset);
    offset = functionCount.nextOffset;

    if (functionCount.value < 1) {
      throw new Error("expected at least one function body");
    }

    const bodySize = readU32Leb(moduleBytes, offset);
    offset = bodySize.nextOffset;

    const bodyEnd = offset + bodySize.value;
    const localGroupCount = readU32Leb(moduleBytes, offset);
    offset = localGroupCount.nextOffset;

    let localCount = 0;

    for (let groupIndex = 0; groupIndex < localGroupCount.value; groupIndex += 1) {
      const groupCount = readU32Leb(moduleBytes, offset);
      offset = groupCount.nextOffset + 1;
      localCount += groupCount.value;
    }

    if (offset > bodyEnd) {
      throw new Error("function local declarations exceeded body size");
    }

    return localCount;
  }

  throw new Error("module has no code section");
}

function readU32Leb(bytes: Uint8Array, offset: number): Readonly<{ value: number; nextOffset: number }> {
  let value = 0;
  let shift = 0;
  let currentOffset = offset;

  while (currentOffset < bytes.byteLength) {
    const byte = bytes[currentOffset];

    if (byte === undefined) {
      break;
    }

    currentOffset += 1;
    value |= (byte & 0x7f) << shift;

    if ((byte & 0x80) === 0) {
      return { value: value >>> 0, nextOffset: currentOffset };
    }

    shift += 7;
  }

  throw new Error(`unterminated LEB128 at offset ${offset}`);
}
