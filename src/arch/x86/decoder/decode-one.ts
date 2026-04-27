import { reg32, type DecodedInstruction } from "../instruction/types.js";
import { ByteReader } from "./byte-reader.js";

const movR32Imm32BaseOpcode = 0xb8;
const movR32Imm32LastOpcode = 0xbf;
const movR32Imm32Length = 5;

export function decodeOne(
  bytes: Uint8Array<ArrayBufferLike>,
  offset: number,
  address: number
): DecodedInstruction {
  const reader = new ByteReader(bytes);
  const opcode = reader.readU8(offset);

  if (opcode < movR32Imm32BaseOpcode || opcode > movR32Imm32LastOpcode) {
    throw new Error(`opcode 0x${opcode.toString(16).padStart(2, "0")} is not implemented`);
  }

  const reg = reg32[opcode - movR32Imm32BaseOpcode];

  if (reg === undefined) {
    throw new Error(`register encoding out of range for opcode 0x${opcode.toString(16)}`);
  }

  return {
    address,
    length: movR32Imm32Length,
    mnemonic: "mov",
    operands: [
      { kind: "reg32", reg },
      { kind: "imm32", value: reader.readU32LE(offset + 1) }
    ],
    raw: Array.from(bytes.slice(offset, offset + movR32Imm32Length)),
    prefixes: []
  };
}
