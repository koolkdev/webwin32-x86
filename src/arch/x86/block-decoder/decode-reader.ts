import type { GuestMemoryDecodeRegion } from "./guest-memory-decode-reader.js";
import type { DecodeFault } from "../decoder/decode-error.js";

export type ByteDecodeRegion = Readonly<{
  kind: "guest-bytes";
  baseAddress: number;
  bytes: Uint8Array<ArrayBufferLike>;
  generation?: number;
}>;

export type DecodeRegion = ByteDecodeRegion | GuestMemoryDecodeRegion;

export type DecodeReader = Readonly<{
  regions?: readonly DecodeRegion[];
  regionAt(eip: number): DecodeRegion | undefined;
  readU8(eip: number): number | DecodeFault;
  sliceFrom(eip: number, maxBytes: number): Uint8Array<ArrayBufferLike> | DecodeFault;
}>;

export function decodeRegionByteLength(region: DecodeRegion): number {
  return region.kind === "guest-memory" ? region.byteLength : region.bytes.length;
}
