import type { Mnemonic } from "../instruction/mnemonic.js";
import type { Operand, DecodedInstruction } from "../instruction/types.js";
import type { DecodeContext } from "./decode-context.js";
import { instructionLength, instructionRaw } from "./decode-context.js";

export function decodedInstruction(
  context: DecodeContext,
  endOffset: number,
  mnemonic: Mnemonic,
  operands: readonly Operand[]
): DecodedInstruction {
  return {
    address: context.address,
    length: instructionLength(context, endOffset),
    mnemonic,
    operands,
    raw: instructionRaw(context, endOffset),
    prefixes: context.prefixes
  };
}

export function unsupportedInstruction(context: DecodeContext, endOffset: number): DecodedInstruction {
  return decodedInstruction(context, endOffset, "unsupported", []);
}
