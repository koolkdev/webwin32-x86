import { ByteReader } from "./byte-reader.js";
import { DecodeError, type DecodeFaultReason } from "./decode-error.js";

export const maxInstructionLength = 15;

export function ensureInstructionBytes(
  reader: ByteReader,
  readOffset: number,
  byteCount: number,
  address: number,
  instructionOffset: number
): void {
  if (readOffset + byteCount > instructionOffset + maxInstructionLength) {
    throwDecodeError("instructionTooLong", reader, address, instructionOffset);
  }

  if (readOffset < 0 || readOffset + byteCount > reader.length) {
    throwDecodeError("truncated", reader, address, instructionOffset);
  }
}

export function throwDecodeError(
  reason: DecodeFaultReason,
  reader: ByteReader,
  address: number,
  instructionOffset: number
): never {
  const endOffset = Math.min(reader.length, instructionOffset + maxInstructionLength + 1);

  throw new DecodeError({
    reason,
    address,
    offset: instructionOffset,
    raw: reader.raw(instructionOffset, endOffset)
  });
}
