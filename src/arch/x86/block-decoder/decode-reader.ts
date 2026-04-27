import type { DecodeFault } from "../decoder/decode-error.js";

export type HostCallId = number;
export type HostCallConvention = "cdecl" | "stdcall" | "winapi" | "pascal16" | "custom";

export type DecodeRegion =
  | Readonly<{
      kind: "guest-bytes";
      baseAddress: number;
      bytes: Uint8Array<ArrayBufferLike>;
      generation?: number;
    }>
  | Readonly<{
      kind: "host-thunk";
      address: number;
      name: string;
      hostCallId: HostCallId;
      convention: HostCallConvention;
    }>;

export type DecodeReader = Readonly<{
  identity: string;
  regionAt(eip: number): DecodeRegion | undefined;
  readU8(eip: number): number | DecodeFault;
  sliceFrom(eip: number, maxBytes: number): Uint8Array<ArrayBufferLike> | DecodeFault;
}>;

