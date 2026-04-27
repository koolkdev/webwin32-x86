import { instructionPrefixes } from "../instruction/prefix.js";
import type { Mnemonic } from "../instruction/mnemonic.js";
import { reg32, type DecodedInstruction, type Operand } from "../instruction/types.js";
import type { DecodeContext } from "./decode-context.js";
import { ensureInstructionBytes } from "./decode-bounds.js";
import { opcodeEntry, prefixEntry, type DecodeTable, type OpcodeHandler } from "./decode-table.js";
import { signedImm8 } from "./immediate.js";
import { decodedInstruction, unsupportedInstruction } from "./instruction.js";
import { decodeRegisterModRm } from "./modrm.js";
import { movR32Imm32Length, opcode } from "./opcodes.js";

export const opcodeHandlers = buildOpcodeHandlers();

function buildOpcodeHandlers(): DecodeTable {
  const handlers = new Array<DecodeTable[number]>(256);

  for (const prefix of instructionPrefixes) {
    handlers[prefix.byte] = prefixEntry(prefix);
  }

  handlers[opcode.nop] = opcodeEntry(decodeNop, {
    prefixForms: { operandSizeOverride: decodeNop }
  });
  handlers[opcode.addRm32R32] = registerModRmEntry(decodeRm32R32("add"));
  handlers[opcode.addR32Rm32] = registerModRmEntry(decodeR32Rm32("add"));
  handlers[opcode.subRm32R32] = registerModRmEntry(decodeRm32R32("sub"));
  handlers[opcode.subR32Rm32] = registerModRmEntry(decodeR32Rm32("sub"));
  handlers[opcode.xorRm32R32] = registerModRmEntry(decodeRm32R32("xor"));
  handlers[opcode.xorR32Rm32] = registerModRmEntry(decodeR32Rm32("xor"));
  handlers[opcode.cmpRm32R32] = registerModRmEntry(decodeRm32R32("cmp"));
  handlers[opcode.cmpR32Rm32] = registerModRmEntry(decodeR32Rm32("cmp"));
  handlers[opcode.testRm32R32] = registerModRmEntry(decodeRm32R32("test"));
  handlers[opcode.movRm32R32] = registerModRmEntry(decodeRm32R32("mov"));
  handlers[opcode.movR32Rm32] = registerModRmEntry(decodeR32Rm32("mov"));
  handlers[opcode.int] = opcodeEntry(decodeInt);
  handlers[opcode.escape] = opcodeEntry(decodeEscapedUnsupported);

  for (let value = opcode.movR32Imm32Base; value <= opcode.movR32Imm32Last; value += 1) {
    handlers[value] = opcodeEntry(decodeMovR32Imm32, {
      prefixForms: { operandSizeOverride: decodeUnsupported(2) }
    });
  }

  return handlers;
}

function decodeNop(context: DecodeContext): DecodedInstruction {
  return decodedInstruction(context, context.opcodeOffset + 1, "nop", []);
}

function decodeInt(context: DecodeContext): DecodedInstruction {
  ensureDecodeBytes(context, context.opcodeOffset + 1, 1);

  const value = context.reader.readU8(context.opcodeOffset + 1);
  const operands: Operand[] = [{ kind: "imm8", value, signedValue: signedImm8(value) }];

  return decodedInstruction(context, context.opcodeOffset + 2, "int", operands);
}

function decodeEscapedUnsupported(context: DecodeContext): DecodedInstruction {
  ensureDecodeBytes(context, context.opcodeOffset + 1, 1);
  return unsupportedInstruction(context, context.opcodeOffset + 2);
}

function registerModRmEntry(handler: OpcodeHandler) {
  return opcodeEntry(handler, {
    prefixForms: { operandSizeOverride: decodeUnsupported(1) }
  });
}

function decodeRm32R32(mnemonic: Mnemonic): OpcodeHandler {
  return (context) => {
    const modrm = readRegisterModRm(context);

    if (modrm === undefined) {
      return unsupportedInstruction(context, context.opcodeOffset + 2);
    }

    return decodedInstruction(context, context.opcodeOffset + 2, mnemonic, [
      { kind: "reg32", reg: modrm.rm },
      { kind: "reg32", reg: modrm.reg }
    ]);
  };
}

function decodeR32Rm32(mnemonic: Mnemonic): OpcodeHandler {
  return (context) => {
    const modrm = readRegisterModRm(context);

    if (modrm === undefined) {
      return unsupportedInstruction(context, context.opcodeOffset + 2);
    }

    return decodedInstruction(context, context.opcodeOffset + 2, mnemonic, [
      { kind: "reg32", reg: modrm.reg },
      { kind: "reg32", reg: modrm.rm }
    ]);
  };
}

function decodeMovR32Imm32(context: DecodeContext, value: number): DecodedInstruction {
  ensureDecodeBytes(context, context.opcodeOffset + 1, 4);

  const reg = reg32[value - opcode.movR32Imm32Base];

  if (reg === undefined) {
    throw new Error(`register encoding out of range for opcode 0x${value.toString(16)}`);
  }

  return decodedInstruction(context, context.opcodeOffset + movR32Imm32Length, "mov", [
    { kind: "reg32", reg },
    { kind: "imm32", value: context.reader.readU32LE(context.opcodeOffset + 1) }
  ]);
}

function decodeUnsupported(byteCountAfterOpcode: number): OpcodeHandler {
  return (context) => {
    ensureDecodeBytes(context, context.opcodeOffset + 1, byteCountAfterOpcode);

    return unsupportedInstruction(context, context.opcodeOffset + 1 + byteCountAfterOpcode);
  };
}

function ensureDecodeBytes(context: DecodeContext, readOffset: number, byteCount: number): void {
  ensureInstructionBytes(context.reader, readOffset, byteCount, context.address, context.offset);
}

function readRegisterModRm(context: DecodeContext): ReturnType<typeof decodeRegisterModRm> {
  ensureDecodeBytes(context, context.opcodeOffset + 1, 1);

  return decodeRegisterModRm(context.reader.readU8(context.opcodeOffset + 1));
}
