export class ByteReader {
  readonly #bytes: Uint8Array<ArrayBufferLike>;

  constructor(bytes: Uint8Array<ArrayBufferLike>) {
    this.#bytes = bytes;
  }

  get length(): number {
    return this.#bytes.length;
  }

  readU8(offset: number): number {
    if (!Number.isInteger(offset) || offset < 0 || offset >= this.#bytes.length) {
      throw new RangeError(`u8 read out of bounds at offset ${offset}`);
    }

    return this.#bytes[offset] ?? unreachableByte(offset);
  }

  readU32LE(offset: number): number {
    const byte0 = this.readU8(offset);
    const byte1 = this.readU8(offset + 1);
    const byte2 = this.readU8(offset + 2);
    const byte3 = this.readU8(offset + 3);

    return (byte0 | (byte1 << 8) | (byte2 << 16) | (byte3 << 24)) >>> 0;
  }

  readU16LE(offset: number): number {
    const byte0 = this.readU8(offset);
    const byte1 = this.readU8(offset + 1);

    return byte0 | (byte1 << 8);
  }

  raw(startOffset: number, endOffset: number): number[] {
    return Array.from(this.#bytes.slice(startOffset, endOffset));
  }
}

function unreachableByte(offset: number): never {
  throw new RangeError(`u8 read out of bounds at offset ${offset}`);
}
