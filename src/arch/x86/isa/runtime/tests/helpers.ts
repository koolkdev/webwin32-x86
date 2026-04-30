import type { IsaDecodedInstruction, IsaDecodeResult } from "../../decoder/types.js";

export const startAddress = 0x1000;

export function bytes(values: readonly number[]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(values);
}

export function ok(result: IsaDecodeResult): IsaDecodedInstruction {
  if (result.kind !== "ok") {
    throw new Error(`expected ISA decode success, got unsupported byte ${result.unsupportedByte}`);
  }

  return result.instruction;
}
