import { decodeOne } from "../arch/x86/decoder/decoder.js";
import type { DecodedInstruction } from "../arch/x86/instruction/types.js";

export const startAddress = 0x1000;

export function decodeBytes(bytes: readonly number[], baseAddress = startAddress): DecodedInstruction[] {
  const code = Uint8Array.from(bytes);
  const instructions: DecodedInstruction[] = [];
  let offset = 0;

  while (offset < code.length) {
    const instruction = decodeOne(code, offset, baseAddress + offset);
    instructions.push(instruction);
    offset += instruction.length;
  }

  return instructions;
}
