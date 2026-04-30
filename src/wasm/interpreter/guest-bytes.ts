import { wasmMemoryIndex } from "../abi.js";
import { emitExitResultFromStackPayload } from "../codegen/exit.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { ExitReason } from "../exit.js";

const wasmPageByteShift = 16;

export function emitLoadGuestByte(
  body: WasmFunctionBodyEncoder,
  eipLocal: number,
  instructionOffset: number,
  addressLocal: number,
  byteLocal: number
): void {
  body.localGet(eipLocal);

  if (instructionOffset !== 0) {
    body.i32Const(instructionOffset).i32Add();
  }

  body.localSet(addressLocal);
  body
    .localGet(addressLocal)
    .memorySize(wasmMemoryIndex.guest)
    .i32Const(wasmPageByteShift)
    .i32Shl()
    .i32LtU()
    .i32Eqz()
    .ifBlock();
  body.localGet(addressLocal);
  emitExitResultFromStackPayload(body, ExitReason.DECODE_FAULT).returnFromFunction();
  body.endBlock();
  body.localGet(addressLocal).i32Load8U({ align: 0, offset: 0, memoryIndex: wasmMemoryIndex.guest }).localSet(byteLocal);
}
