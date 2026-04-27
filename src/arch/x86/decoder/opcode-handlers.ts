import { jccConditions, type JccCondition } from "../instruction/condition.js";
import { instructionPrefixes } from "../instruction/prefix.js";
import type { Mnemonic } from "../instruction/mnemonic.js";
import { reg32, type DecodedInstruction, type Operand } from "../instruction/types.js";
import type { DecodeContext } from "./decode-context.js";
import { ensureInstructionBytes } from "./decode-bounds.js";
import { opcodeEntry, prefixEntry, type DecodeTable, type OpcodeHandler } from "./decode-table.js";
import { signedImm8, signedImm32 } from "./immediate.js";
import { decodedInstruction, unsupportedInstruction } from "./instruction.js";
import { decodeRegisterModRm, type RegisterModRm } from "./modrm.js";
import { movR32Imm32Length, opcode, opcodeMap0f } from "./opcodes.js";

export const opcodeHandlers = buildOpcodeHandlers();
const opcodeMap0fHandlers = buildOpcodeMap0fHandlers();
const group81Handlers = buildGroup81Handlers();
const group83Handlers = buildGroup83Handlers();

type ModRmHandler = (context: DecodeContext, modrm: RegisterModRm) => DecodedInstruction;

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
  handlers[opcode.group81] = opcodeEntry(decodeGroup81Register, {
    prefixForms: { operandSizeOverride: decodeUnsupported(3) }
  });
  handlers[opcode.group83] = opcodeEntry(decodeGroup83Register, {
    prefixForms: { operandSizeOverride: decodeUnsupported(2) }
  });
  handlers[opcode.movRm32R32] = registerModRmEntry(decodeRm32R32("mov"));
  handlers[opcode.movR32Rm32] = registerModRmEntry(decodeR32Rm32("mov"));
  handlers[opcode.int] = opcodeEntry(decodeInt);
  handlers[opcode.jmpRel8] = opcodeEntry(decodeJmpRel8);
  handlers[opcode.jmpRel32] = opcodeEntry(decodeJmpRel32);
  handlers[opcode.escape] = opcodeEntry(decodeOpcodeMap0f);

  for (let value = opcode.jccRel8Base; value <= opcode.jccRel8Last; value += 1) {
    handlers[value] = opcodeEntry(decodeJccRel8);
  }

  for (let value = opcode.movR32Imm32Base; value <= opcode.movR32Imm32Last; value += 1) {
    handlers[value] = opcodeEntry(decodeMovR32Imm32, {
      prefixForms: { operandSizeOverride: decodeUnsupported(2) }
    });
  }

  return handlers;
}

function buildOpcodeMap0fHandlers(): DecodeTable {
  const handlers = new Array<DecodeTable[number]>(256);

  for (let value = opcodeMap0f.jccRel32Base; value <= opcodeMap0f.jccRel32Last; value += 1) {
    handlers[value] = opcodeEntry(decodeJccRel32);
  }

  return handlers;
}

function buildGroup81Handlers(): readonly (ModRmHandler | undefined)[] {
  const handlers = new Array<ModRmHandler | undefined>(8);

  handlers[0] = decodeGroup81Rm32Imm32("add");
  handlers[5] = decodeGroup81Rm32Imm32("sub");
  handlers[7] = decodeGroup81Rm32Imm32("cmp");

  return handlers;
}

function buildGroup83Handlers(): readonly (ModRmHandler | undefined)[] {
  const handlers = new Array<ModRmHandler | undefined>(8);

  handlers[0] = decodeGroup83Rm32Imm8("add");
  handlers[5] = decodeGroup83Rm32Imm8("sub");
  handlers[7] = decodeGroup83Rm32Imm8("cmp");

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

function decodeJmpRel8(context: DecodeContext): DecodedInstruction {
  const endOffset = context.opcodeOffset + 2;

  ensureDecodeBytes(context, context.opcodeOffset + 1, 1);

  const displacement = signedImm8(context.reader.readU8(context.opcodeOffset + 1));

  return decodedInstruction(context, endOffset, "jmp", [
    { kind: "rel8", displacement, target: relativeTarget(context, endOffset, displacement) }
  ]);
}

function decodeJmpRel32(context: DecodeContext): DecodedInstruction {
  const endOffset = context.opcodeOffset + 5;

  ensureDecodeBytes(context, context.opcodeOffset + 1, 4);

  const displacement = signedImm32(context.reader.readU32LE(context.opcodeOffset + 1));

  return decodedInstruction(context, endOffset, "jmp", [
    { kind: "rel32", displacement, target: relativeTarget(context, endOffset, displacement) }
  ]);
}

function decodeJccRel8(context: DecodeContext, value: number): DecodedInstruction {
  const endOffset = context.opcodeOffset + 2;

  ensureDecodeBytes(context, context.opcodeOffset + 1, 1);

  const condition = jccCondition(value, opcode.jccRel8Base);

  const displacement = signedImm8(context.reader.readU8(context.opcodeOffset + 1));

  return decodedJccInstruction(context, endOffset, condition, {
    kind: "rel8",
    displacement,
    target: relativeTarget(context, endOffset, displacement)
  });
}

function decodeOpcodeMap0f(context: DecodeContext): DecodedInstruction {
  ensureDecodeBytes(context, context.opcodeOffset + 1, 1);

  const secondByte = context.reader.readU8(context.opcodeOffset + 1);
  const entry = opcodeMap0fHandlers[secondByte];

  if (entry?.kind !== "opcode") {
    return unsupportedInstruction(context, context.opcodeOffset + 2);
  }

  return entry.handler(context, secondByte);
}

function decodeJccRel32(context: DecodeContext, value: number): DecodedInstruction {
  const endOffset = context.opcodeOffset + 6;

  ensureDecodeBytes(context, context.opcodeOffset + 2, 4);

  const condition = jccCondition(value, opcodeMap0f.jccRel32Base);
  const displacement = signedImm32(context.reader.readU32LE(context.opcodeOffset + 2));

  return decodedJccInstruction(context, endOffset, condition, {
    kind: "rel32",
    displacement,
    target: relativeTarget(context, endOffset, displacement)
  });
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

function decodeGroup81Register(context: DecodeContext): DecodedInstruction {
  const modrm = readRegisterModRm(context);

  if (modrm === undefined) {
    return unsupportedInstruction(context, context.opcodeOffset + 2);
  }

  ensureDecodeBytes(context, context.opcodeOffset + 2, 4);

  const handler = group81Handlers[modrm.regField];

  if (handler === undefined) {
    return unsupportedInstruction(context, context.opcodeOffset + 6);
  }

  return handler(context, modrm);
}

function decodeGroup81Rm32Imm32(mnemonic: Extract<Mnemonic, "add" | "sub" | "cmp">): ModRmHandler {
  return (context, modrm) =>
    decodedInstruction(context, context.opcodeOffset + 6, mnemonic, [
      { kind: "reg32", reg: modrm.rm },
      { kind: "imm32", value: context.reader.readU32LE(context.opcodeOffset + 2) }
    ]);
}

function decodeGroup83Register(context: DecodeContext): DecodedInstruction {
  const modrm = readRegisterModRm(context);

  if (modrm === undefined) {
    return unsupportedInstruction(context, context.opcodeOffset + 2);
  }

  ensureDecodeBytes(context, context.opcodeOffset + 2, 1);

  const handler = group83Handlers[modrm.regField];

  if (handler === undefined) {
    return unsupportedInstruction(context, context.opcodeOffset + 3);
  }

  return handler(context, modrm);
}

function decodeGroup83Rm32Imm8(mnemonic: Extract<Mnemonic, "add" | "sub" | "cmp">): ModRmHandler {
  return (context, modrm) => {
    const value = context.reader.readU8(context.opcodeOffset + 2);

    return decodedInstruction(context, context.opcodeOffset + 3, mnemonic, [
      { kind: "reg32", reg: modrm.rm },
      { kind: "imm8", value, signedValue: signedImm8(value) }
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

function relativeTarget(context: DecodeContext, endOffset: number, displacement: number): number {
  return (context.address + endOffset - context.offset + displacement) >>> 0;
}

function jccCondition(value: number, base: number): JccCondition {
  const condition = jccConditions[value - base];

  if (condition === undefined) {
    throw new Error(`Jcc condition encoding out of range for opcode 0x${value.toString(16)}`);
  }

  return condition;
}

function decodedJccInstruction(
  context: DecodeContext,
  endOffset: number,
  condition: JccCondition,
  operand: Operand
): DecodedInstruction {
  return {
    ...decodedInstruction(context, endOffset, "jcc", [operand]),
    condition
  };
}

function ensureDecodeBytes(context: DecodeContext, readOffset: number, byteCount: number): void {
  ensureInstructionBytes(context.reader, readOffset, byteCount, context.address, context.offset);
}

function readRegisterModRm(context: DecodeContext): ReturnType<typeof decodeRegisterModRm> {
  ensureDecodeBytes(context, context.opcodeOffset + 1, 1);

  return decodeRegisterModRm(context.reader.readU8(context.opcodeOffset + 1));
}
