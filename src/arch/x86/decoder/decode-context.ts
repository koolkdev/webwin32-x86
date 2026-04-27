import type { Prefix } from "../instruction/prefix.js";
import { ByteReader } from "./byte-reader.js";

export type DecodeContext = Readonly<{
  reader: ByteReader;
  address: number;
  offset: number;
  prefixes: readonly Prefix[];
  opcodeOffset: number;
}>;

export function instructionLength(context: DecodeContext, endOffset: number): number {
  return endOffset - context.offset;
}

export function instructionRaw(context: DecodeContext, endOffset: number): number[] {
  return context.reader.raw(context.offset, endOffset);
}
