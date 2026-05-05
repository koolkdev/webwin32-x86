import type { RegisterAlias } from "#x86/isa/types.js";
import { i32 } from "#x86/state/cpu-state.js";
import { wasmMemoryIndex } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { emitMaskValueToWidth } from "#backends/wasm/codegen/registers.js";
import { aliasMask, byteCount, byteMask, byteWidth, type ByteSource, type RegValueState } from "./register-lanes.js";

export function emitStoreStateU8(
  body: WasmFunctionBodyEncoder,
  offset: number,
  emitValue: () => void
): void {
  body.i32Const(0);
  emitValue();
  body.i32Store8({
    align: 0,
    memoryIndex: wasmMemoryIndex.state,
    offset
  });
}

export function emitStoreStateU16(
  body: WasmFunctionBodyEncoder,
  offset: number,
  emitValue: () => void
): void {
  body.i32Const(0);
  emitValue();
  body.i32Store16({
    align: offset % 2 === 0 ? 1 : 0,
    memoryIndex: wasmMemoryIndex.state,
    offset
  });
}

export function emitStoreAliasValueIntoFullLocal(
  body: WasmFunctionBodyEncoder,
  fullLocal: number,
  alias: RegisterAlias,
  valueLocal: number
): void {
  const shiftedMask = aliasMask(alias);

  body.localGet(fullLocal).i32Const(i32(~shiftedMask)).i32And();
  body.localGet(valueLocal);

  if (alias.bitOffset !== 0) {
    body.i32Const(alias.bitOffset).i32Shl();
  }

  body.i32Or().localSet(fullLocal);
}

export function emitStoreByteSourceIntoFullLocal(
  body: WasmFunctionBodyEncoder,
  fullLocal: number,
  byteIndex: number,
  source: ByteSource
): void {
  const shift = byteIndex * byteWidth;
  const shiftedMask = byteMask << shift;

  body.localGet(fullLocal).i32Const(i32(~shiftedMask)).i32And();
  emitByteSource(body, source);

  if (shift !== 0) {
    body.i32Const(shift).i32Shl();
  }

  body.i32Or().localSet(fullLocal);
}

export function emitMergedBytes(body: WasmFunctionBodyEncoder, state: RegValueState): void {
  if (state.fullLocal !== undefined) {
    return;
  }

  for (let byteIndex = 0; byteIndex < byteCount; byteIndex += 1) {
    const source = state.bytes[byteIndex];

    if (source === undefined) {
      continue;
    }

    const shift = byteIndex * byteWidth;
    const shiftedMask = byteMask << shift;

    body.i32Const(i32(~shiftedMask)).i32And();
    emitByteSource(body, source);

    if (shift !== 0) {
      body.i32Const(shift).i32Shl();
    }

    body.i32Or();
  }
}

export function emitExtractAliasFromLocal(
  body: WasmFunctionBodyEncoder,
  local: number,
  alias: RegisterAlias
): void {
  body.localGet(local);

  if (alias.bitOffset !== 0) {
    body.i32Const(alias.bitOffset).i32ShrU();
  }

  emitMaskValueToWidth(body, alias.width);
}

export function emitComposedByteSources(
  body: WasmFunctionBodyEncoder,
  sources: readonly ByteSource[]
): void {
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];

    if (source === undefined) {
      throw new Error(`missing byte source: ${index}`);
    }

    emitByteSource(body, source);

    const shift = index * byteWidth;

    if (shift !== 0) {
      body.i32Const(shift).i32Shl();
    }

    if (index !== 0) {
      body.i32Or();
    }
  }
}

export function emitByteSource(body: WasmFunctionBodyEncoder, source: ByteSource): void {
  body.localGet(source.local);

  if (source.bitOffset !== 0) {
    body.i32Const(source.bitOffset).i32ShrU();
  }

  body.i32Const(byteMask).i32And();
}
