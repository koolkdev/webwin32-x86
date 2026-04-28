import type { DecodeFault } from "../decoder/decode-error.js";

export type DecodeRegion = Readonly<{
  kind: "guest-bytes";
  baseAddress: number;
  bytes: Uint8Array<ArrayBufferLike>;
  generation?: number;
}>;

export type DecodeReader = Readonly<{
  regionAt(eip: number): DecodeRegion | undefined;
  readU8(eip: number): number | DecodeFault;
  sliceFrom(eip: number, maxBytes: number): Uint8Array<ArrayBufferLike> | DecodeFault;
}>;
