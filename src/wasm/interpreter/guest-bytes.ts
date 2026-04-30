import { wasmMemoryIndex } from "../abi.js";
import { emitExitResultFromStackPayload } from "../codegen/exit.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { ExitReason } from "../exit.js";

const wasmPageByteShift = 16;
const u32ByteLength = 4;

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
  emitFaultIfGuestByteOutOfBounds(body, addressLocal);
  body.localGet(addressLocal).i32Load8U({ align: 0, offset: 0, memoryIndex: wasmMemoryIndex.guest }).localSet(byteLocal);
}

export function emitLoadGuestByteForDecodeAtDynamicOffset(
  body: WasmFunctionBodyEncoder,
  eipLocal: number,
  instructionOffsetLocal: number,
  addressLocal: number,
  byteLocal: number
): void {
  body.localGet(eipLocal).localGet(instructionOffsetLocal).i32Add().localSet(addressLocal);
  emitFaultIfGuestByteOutOfBounds(body, addressLocal);
  body.localGet(addressLocal).i32Load8U({ align: 0, offset: 0, memoryIndex: wasmMemoryIndex.guest }).localSet(byteLocal);
}

export function emitLoadGuestU32ForDecode(
  body: WasmFunctionBodyEncoder,
  eipLocal: number,
  instructionOffset: number,
  addressLocal: number,
  valueLocal: number
): void {
  body.localGet(eipLocal);

  if (instructionOffset !== 0) {
    body.i32Const(instructionOffset).i32Add();
  }

  body.localSet(addressLocal);
  emitFaultIfGuestU32OutOfBounds(body, addressLocal);
  body.localGet(addressLocal).i32Load({ align: 0, offset: 0, memoryIndex: wasmMemoryIndex.guest }).localSet(valueLocal);
}

export function emitLoadGuestU32ForDecodeAtDynamicOffset(
  body: WasmFunctionBodyEncoder,
  eipLocal: number,
  instructionOffsetLocal: number,
  addressLocal: number,
  valueLocal: number
): void {
  body.localGet(eipLocal).localGet(instructionOffsetLocal).i32Add().localSet(addressLocal);
  emitFaultIfGuestU32OutOfBounds(body, addressLocal);
  body.localGet(addressLocal).i32Load({ align: 0, offset: 0, memoryIndex: wasmMemoryIndex.guest }).localSet(valueLocal);
}

function emitFaultIfGuestByteOutOfBounds(body: WasmFunctionBodyEncoder, addressLocal: number): void {
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
}

function emitFaultIfGuestU32OutOfBounds(body: WasmFunctionBodyEncoder, addressLocal: number): void {
  body
    .memorySize(wasmMemoryIndex.guest)
    .i32Const(wasmPageByteShift)
    .i32Shl()
    .i32Const(u32ByteLength)
    .i32Sub()
    .localGet(addressLocal)
    .i32LtU()
    .ifBlock();
  body.localGet(addressLocal);
  emitExitResultFromStackPayload(body, ExitReason.DECODE_FAULT).returnFromFunction();
  body.endBlock();
}
