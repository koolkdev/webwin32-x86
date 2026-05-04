import { wasmMemoryIndex } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";

export const stateU32Align = 2;

export function emitLoadStateU32(body: WasmFunctionBodyEncoder, offset: number): void {
  body.i32Const(0).i32Load({
    align: stateU32Align,
    memoryIndex: wasmMemoryIndex.state,
    offset
  });
}

export function emitStoreStateStackU32(body: WasmFunctionBodyEncoder, offset: number): void {
  body.i32Store({
    align: stateU32Align,
    memoryIndex: wasmMemoryIndex.state,
    offset
  });
}

export function emitStoreStateU32(body: WasmFunctionBodyEncoder, offset: number, emitValue: () => void): void {
  body.i32Const(0);
  emitValue();
  emitStoreStateStackU32(body, offset);
}
