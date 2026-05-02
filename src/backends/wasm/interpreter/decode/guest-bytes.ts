import { wasmMemoryIndex } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { ExitReason } from "#backends/wasm/exit.js";
import { emitWasmIrExitFromI32Stack, type WasmIrExitTarget } from "#backends/wasm/lowering/exit.js";

const wasmPageByteShift = 16;
const u32ByteLength = 4;

export function emitLoadGuestByte(
  body: WasmFunctionBodyEncoder,
  eipLocal: number,
  instructionOffset: number,
  addressLocal: number,
  byteLocal: number,
  exit?: WasmIrExitTarget
): void {
  body.localGet(eipLocal);

  if (instructionOffset !== 0) {
    body.i32Const(instructionOffset).i32Add();
  }

  body.localSet(addressLocal);
  emitFaultIfGuestByteOutOfBounds(body, addressLocal, exit);
  body.localGet(addressLocal).i32Load8U({ align: 0, offset: 0, memoryIndex: wasmMemoryIndex.guest }).localSet(byteLocal);
}

export function emitLoadGuestByteForDecodeAtDynamicOffset(
  body: WasmFunctionBodyEncoder,
  eipLocal: number,
  instructionOffsetLocal: number,
  addressLocal: number,
  byteLocal: number,
  exit?: WasmIrExitTarget
): void {
  body.localGet(eipLocal).localGet(instructionOffsetLocal).i32Add().localSet(addressLocal);
  emitFaultIfGuestByteOutOfBounds(body, addressLocal, exit);
  body.localGet(addressLocal).i32Load8U({ align: 0, offset: 0, memoryIndex: wasmMemoryIndex.guest }).localSet(byteLocal);
}

export function emitLoadGuestU32ForDecode(
  body: WasmFunctionBodyEncoder,
  eipLocal: number,
  instructionOffset: number,
  addressLocal: number,
  valueLocal: number,
  exit?: WasmIrExitTarget
): void {
  body.localGet(eipLocal);

  if (instructionOffset !== 0) {
    body.i32Const(instructionOffset).i32Add();
  }

  body.localSet(addressLocal);
  emitFaultIfGuestU32OutOfBounds(body, addressLocal, exit);
  body.localGet(addressLocal).i32Load({ align: 0, offset: 0, memoryIndex: wasmMemoryIndex.guest }).localSet(valueLocal);
}

export function emitLoadGuestU32ForDecodeAtDynamicOffset(
  body: WasmFunctionBodyEncoder,
  eipLocal: number,
  instructionOffsetLocal: number,
  addressLocal: number,
  valueLocal: number,
  exit?: WasmIrExitTarget
): void {
  body.localGet(eipLocal).localGet(instructionOffsetLocal).i32Add().localSet(addressLocal);
  emitFaultIfGuestU32OutOfBounds(body, addressLocal, exit);
  body.localGet(addressLocal).i32Load({ align: 0, offset: 0, memoryIndex: wasmMemoryIndex.guest }).localSet(valueLocal);
}

function emitFaultIfGuestByteOutOfBounds(
  body: WasmFunctionBodyEncoder,
  addressLocal: number,
  exit?: WasmIrExitTarget
): void {
  body
    .localGet(addressLocal)
    .memorySize(wasmMemoryIndex.guest)
    .i32Const(wasmPageByteShift)
    .i32Shl()
    .i32LtU()
    .i32Eqz()
    .ifBlock();
  emitDecodeFault(body, addressLocal, exit, 1);
  body.endBlock();
}

function emitFaultIfGuestU32OutOfBounds(
  body: WasmFunctionBodyEncoder,
  addressLocal: number,
  exit?: WasmIrExitTarget
): void {
  body
    .memorySize(wasmMemoryIndex.guest)
    .i32Const(wasmPageByteShift)
    .i32Shl()
    .i32Const(u32ByteLength)
    .i32Sub()
    .localGet(addressLocal)
    .i32LtU()
    .ifBlock();
  emitDecodeFault(body, addressLocal, exit, 1);
  body.endBlock();
}

function emitDecodeFault(
  body: WasmFunctionBodyEncoder,
  addressLocal: number,
  exit: WasmIrExitTarget | undefined,
  extraDepth: number
): void {
  if (exit === undefined) {
    body.localGet(addressLocal);
    throw new Error("interpreter guest-byte fault requires an exit target");
  }

  body.localGet(addressLocal);
  emitWasmIrExitFromI32Stack(body, exit, ExitReason.DECODE_FAULT, extraDepth);
}
