import { ByteReader } from "./byte-reader.js";

export type DecodeContext = Readonly<{
  reader: ByteReader;
  address: number;
  offset: number;
  prefixes: readonly [];
  opcodeOffset: number;
}>;

export function createDecodeContext(
  bytes: Uint8Array<ArrayBufferLike>,
  offset: number,
  address: number
): DecodeContext {
  const reader = new ByteReader(bytes);

  return {
    reader,
    address,
    offset,
    prefixes: [],
    opcodeOffset: offset
  };
}

export function readOpcode(context: DecodeContext): number {
  return context.reader.readU8(context.opcodeOffset);
}

export function instructionLength(context: DecodeContext, endOffset: number): number {
  return endOffset - context.offset;
}

export function instructionRaw(context: DecodeContext, endOffset: number): number[] {
  return context.reader.raw(context.offset, endOffset);
}
