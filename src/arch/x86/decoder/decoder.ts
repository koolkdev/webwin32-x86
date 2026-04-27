import { reg32, type DecodedInstruction, type Operand } from "../instruction/types.js";
import { createDecodeContext, readOpcode, type DecodeContext } from "./decode-context.js";
import { signedImm8 } from "./immediate.js";
import { decodedInstruction, unsupportedInstruction } from "./instruction.js";
import { movR32Imm32Length, opcode } from "./opcodes.js";

type OpcodeHandler = (context: DecodeContext, opcode: number) => DecodedInstruction;

const opcodeHandlers = buildPrimaryOpcodeHandlers();

export function decodeOne(
  bytes: Uint8Array<ArrayBufferLike>,
  offset: number,
  address: number
): DecodedInstruction {
  const context = createDecodeContext(bytes, offset, address);
  const value = readOpcode(context);
  const handler = opcodeHandlers[value];

  if (handler !== undefined) {
    return handler(context, value);
  }

  return unsupportedInstruction(context, context.opcodeOffset + 1);
}

function buildPrimaryOpcodeHandlers(): readonly (OpcodeHandler | undefined)[] {
  const handlers = new Array<OpcodeHandler | undefined>(256);

  handlers[opcode.nop] = decodeNop;
  handlers[opcode.int] = decodeInt;
  handlers[opcode.escape] = decodeEscapedUnsupported;

  for (let value = opcode.movR32Imm32Base; value <= opcode.movR32Imm32Last; value += 1) {
    handlers[value] = decodeMovR32Imm32;
  }

  return handlers;
}

function decodeNop(context: DecodeContext): DecodedInstruction {
  return decodedInstruction(context, context.opcodeOffset + 1, "nop", []);
}

function decodeInt(context: DecodeContext): DecodedInstruction {
  const value = context.reader.readU8(context.opcodeOffset + 1);
  const operands: Operand[] = [{ kind: "imm8", value, signedValue: signedImm8(value) }];

  return decodedInstruction(context, context.opcodeOffset + 2, "int", operands);
}

function decodeEscapedUnsupported(context: DecodeContext): DecodedInstruction {
  return unsupportedInstruction(context, context.opcodeOffset + 1);
}

function decodeMovR32Imm32(context: DecodeContext, value: number): DecodedInstruction {
  const reg = reg32[value - opcode.movR32Imm32Base];

  if (reg === undefined) {
    throw new Error(`register encoding out of range for opcode 0x${value.toString(16)}`);
  }

  return decodedInstruction(context, context.opcodeOffset + movR32Imm32Length, "mov", [
    { kind: "reg32", reg },
    { kind: "imm32", value: context.reader.readU32LE(context.opcodeOffset + 1) }
  ]);
}
