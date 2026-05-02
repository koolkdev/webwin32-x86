import type { InterpreterInstructionLength } from "./ir-context.js";
import { wasmValueType } from "../encoder/types.js";
import {
  emitLoadGuestByte,
  emitLoadGuestByteForDecodeAtDynamicOffset,
  emitLoadGuestU32ForDecode,
  emitLoadGuestU32ForDecodeAtDynamicOffset
} from "./guest-bytes.js";
import type { InterpreterHandlerContext } from "./handler-context.js";

export type DecodeReader =
  | Readonly<{ kind: "static"; value: number }>
  | Readonly<{ kind: "local"; local: number }>;

export function staticDecodeReader(value: number): DecodeReader {
  return { kind: "static", value };
}

export function localDecodeReader(local: number): DecodeReader {
  return { kind: "local", local };
}

export function instructionLengthFromDecodeReader(decodeReader: DecodeReader): InterpreterInstructionLength {
  return decodeReader.kind === "static" ? decodeReader.value : { kind: "local", local: decodeReader.local };
}

export function advanceDecodeReader(
  decodeReader: DecodeReader,
  byteCount: number,
  context: InterpreterHandlerContext
): DecodeReader {
  if (byteCount === 0) {
    return decodeReader;
  }

  if (decodeReader.kind === "static") {
    return staticDecodeReader(decodeReader.value + byteCount);
  }

  context.body.localGet(decodeReader.local).i32Const(byteCount).i32Add().localSet(decodeReader.local);
  return decodeReader;
}

export function materializeDecodeReader(decodeReader: DecodeReader, context: InterpreterHandlerContext): number {
  const local = context.scratch.allocLocal(wasmValueType.i32);

  if (decodeReader.kind === "static") {
    context.body.i32Const(decodeReader.value).localSet(local);
  } else {
    context.body.localGet(decodeReader.local).localSet(local);
  }

  return local;
}

export function emitReadGuestByte(
  context: InterpreterHandlerContext,
  decodeReader: DecodeReader,
  local: number
): void {
  if (decodeReader.kind === "static") {
    emitLoadGuestByte(context.body, context.eipLocal, decodeReader.value, context.addressLocal, local, context.exit);
    return;
  }

  emitLoadGuestByteForDecodeAtDynamicOffset(
    context.body,
    context.eipLocal,
    decodeReader.local,
    context.addressLocal,
    local,
    context.exit
  );
}

export function emitReadGuestBytePlus(
  context: InterpreterHandlerContext,
  decodeReader: DecodeReader,
  byteOffset: number,
  local: number
): void {
  if (byteOffset === 0) {
    emitReadGuestByte(context, decodeReader, local);
    return;
  }

  if (decodeReader.kind === "static") {
    emitLoadGuestByte(
      context.body,
      context.eipLocal,
      decodeReader.value + byteOffset,
      context.addressLocal,
      local,
      context.exit
    );
    return;
  }

  const offsetLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    context.body.localGet(decodeReader.local).i32Const(byteOffset).i32Add().localSet(offsetLocal);
    emitLoadGuestByteForDecodeAtDynamicOffset(
      context.body,
      context.eipLocal,
      offsetLocal,
      context.addressLocal,
      local,
      context.exit
    );
  } finally {
    context.scratch.freeLocal(offsetLocal);
  }
}

export function emitReadGuestU32(
  context: InterpreterHandlerContext,
  decodeReader: DecodeReader,
  local: number
): void {
  if (decodeReader.kind === "static") {
    emitLoadGuestU32ForDecode(context.body, context.eipLocal, decodeReader.value, context.addressLocal, local, context.exit);
    return;
  }

  emitLoadGuestU32ForDecodeAtDynamicOffset(
    context.body,
    context.eipLocal,
    decodeReader.local,
    context.addressLocal,
    local,
    context.exit
  );
}
