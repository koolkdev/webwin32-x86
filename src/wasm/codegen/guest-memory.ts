import { wasmMemoryIndex } from "../abi.js";
import { wasmBranchHint, type WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { ExitReason } from "../exit.js";
import { emitExitResultFromStackPayload } from "./exit.js";

const u32ByteLength = 4;
const u32Align = 2;
const wasmPageShift = 16;

export function emitLoadGuestU32(body: WasmFunctionBodyEncoder, addressLocal: number): void {
  emitFaultIfU32OutOfBounds(body, addressLocal);
  body.localGet(addressLocal).i32Load({
    align: u32Align,
    memoryIndex: wasmMemoryIndex.guest,
    offset: 0
  });
}

export function emitStoreGuestU32(body: WasmFunctionBodyEncoder, addressLocal: number, valueLocal: number): void {
  emitFaultIfU32OutOfBounds(body, addressLocal);
  body.localGet(addressLocal).localGet(valueLocal).i32Store({
    align: u32Align,
    memoryIndex: wasmMemoryIndex.guest,
    offset: 0
  });
}

function emitFaultIfU32OutOfBounds(body: WasmFunctionBodyEncoder, addressLocal: number): void {
  emitLastValidGuestU32Address(body);
  body.localGet(addressLocal).i32LtU().ifBlock(wasmBranchHint.unlikely);
  body.localGet(addressLocal);
  emitExitResultFromStackPayload(body, ExitReason.MEMORY_FAULT).returnFromFunction().endBlock();
}

function emitLastValidGuestU32Address(body: WasmFunctionBodyEncoder): void {
  body.memorySize(wasmMemoryIndex.guest).i32Const(wasmPageShift).i32Shl().i32Const(u32ByteLength).i32Sub();
}
