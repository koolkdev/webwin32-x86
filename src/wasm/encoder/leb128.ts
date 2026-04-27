export function encodeU32Leb128(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`u32 LEB128 value out of range: ${value}`);
  }

  const bytes: number[] = [];
  let remaining = value >>> 0;

  do {
    const lowBits = remaining & 0x7f;
    remaining >>>= 7;
    appendLeb128Byte(bytes, lowBits, remaining !== 0);
  } while (remaining !== 0);

  return bytes;
}

export function encodeI64Leb128(value: bigint): number[] {
  const minI64 = -(1n << 63n);
  const maxI64 = (1n << 63n) - 1n;

  if (value < minI64 || value > maxI64) {
    throw new RangeError(`i64 LEB128 value out of range: ${value.toString()}`);
  }

  const bytes: number[] = [];
  let remaining = value;
  let more = true;

  while (more) {
    const lowBits = Number(remaining & 0x7fn);
    const signBitSet = (lowBits & 0x40) !== 0;

    remaining >>= 7n;

    if ((remaining === 0n && !signBitSet) || (remaining === -1n && signBitSet)) {
      more = false;
    }

    appendLeb128Byte(bytes, lowBits, more);
  }

  return bytes;
}

function appendLeb128Byte(bytes: number[], lowBits: number, hasMore: boolean): void {
  bytes.push(hasMore ? lowBits | 0x80 : lowBits);
}
