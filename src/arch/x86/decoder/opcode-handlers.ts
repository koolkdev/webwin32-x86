import { jccConditions, type JccCondition } from "../instruction/condition.js";
import { instructionPrefixes } from "../instruction/prefix.js";
import type { Mnemonic } from "../instruction/mnemonic.js";
import { reg32, type DecodedInstruction, type Operand } from "../instruction/types.js";
import type { DecodeContext } from "./decode-context.js";
import { ensureInstructionBytes } from "./decode-bounds.js";
import { opcodeEntry, prefixEntry, type DecodeTable, type OpcodeHandler } from "./decode-table.js";
import { signedImm8, signedImm32 } from "./immediate.js";
import { decodedInstruction, unsupportedInstruction } from "./instruction.js";
import {
  decodeRm32ModRm,
  rm32ModRmHasSib,
  rm32ModRmByteLengthAt
} from "./modrm.js";
import { movR32Imm32Length, opcode, opcodeMap0f } from "./opcodes.js";

export const opcodeHandlers = buildOpcodeHandlers();
const opcodeMap0fHandlers = buildOpcodeMap0fHandlers();
const group81Handlers = buildGroup81Handlers();
const group83Handlers = buildGroup83Handlers();

type ModRmOperands = Readonly<{
  regField: number;
  reg: Operand;
  rm: Operand;
  byteLength: number;
}>;
type GroupRm32Handler = (
  context: DecodeContext,
  operands: ModRmOperands,
  immediateOffset: number
) => DecodedInstruction;

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
  handlers[opcode.pushImm32] = opcodeEntry(decodePushImm32);
  handlers[opcode.pushImm8] = opcodeEntry(decodePushImm8);
  handlers[opcode.group81] = opcodeEntry(decodeGroup81Rm32, {
    prefixForms: { operandSizeOverride: decodeUnsupported(3) }
  });
  handlers[opcode.group83] = opcodeEntry(decodeGroup83Rm32, {
    prefixForms: { operandSizeOverride: decodeUnsupported(2) }
  });
  handlers[opcode.movRm32R32] = registerModRmEntry(decodeRm32R32("mov"));
  handlers[opcode.movR32Rm32] = registerModRmEntry(decodeR32Rm32("mov"));
  handlers[opcode.leaR32M] = registerModRmEntry(decodeR32Rm32("lea", "mem32"));
  handlers[opcode.int] = opcodeEntry(decodeInt);
  handlers[opcode.callRel32] = opcodeEntry(decodeCallRel32);
  handlers[opcode.retNear] = opcodeEntry(decodeRet);
  handlers[opcode.retImm16] = opcodeEntry(decodeRetImm16);
  handlers[opcode.jmpRel8] = opcodeEntry(decodeJmpRel8);
  handlers[opcode.jmpRel32] = opcodeEntry(decodeJmpRel32);
  handlers[opcode.escape] = opcodeEntry(decodeOpcodeMap0f);

  for (let value = opcode.pushR32Base; value <= opcode.pushR32Last; value += 1) {
    handlers[value] = opcodeEntry(decodePushR32);
  }

  for (let value = opcode.popR32Base; value <= opcode.popR32Last; value += 1) {
    handlers[value] = opcodeEntry(decodePopR32);
  }

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

function buildGroup81Handlers(): readonly (GroupRm32Handler | undefined)[] {
  const handlers = new Array<GroupRm32Handler | undefined>(8);

  handlers[0] = decodeGroup81Rm32Imm32("add");
  handlers[5] = decodeGroup81Rm32Imm32("sub");
  handlers[7] = decodeGroup81Rm32Imm32("cmp");

  return handlers;
}

function buildGroup83Handlers(): readonly (GroupRm32Handler | undefined)[] {
  const handlers = new Array<GroupRm32Handler | undefined>(8);

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

function decodeCallRel32(context: DecodeContext): DecodedInstruction {
  const endOffset = context.opcodeOffset + 5;

  ensureDecodeBytes(context, context.opcodeOffset + 1, 4);

  const displacement = signedImm32(context.reader.readU32LE(context.opcodeOffset + 1));

  return decodedInstruction(context, endOffset, "call", [
    { kind: "rel32", displacement, target: relativeTarget(context, endOffset, displacement) }
  ]);
}

function decodeRet(context: DecodeContext): DecodedInstruction {
  return decodedInstruction(context, context.opcodeOffset + 1, "ret", []);
}

function decodeRetImm16(context: DecodeContext): DecodedInstruction {
  ensureDecodeBytes(context, context.opcodeOffset + 1, 2);

  return decodedInstruction(context, context.opcodeOffset + 3, "ret", [
    { kind: "imm16", value: context.reader.readU16LE(context.opcodeOffset + 1) }
  ]);
}

function decodePushR32(context: DecodeContext, value: number): DecodedInstruction {
  return decodedInstruction(context, context.opcodeOffset + 1, "push", [
    registerOperandFromOpcode(value, opcode.pushR32Base)
  ]);
}

function decodePopR32(context: DecodeContext, value: number): DecodedInstruction {
  return decodedInstruction(context, context.opcodeOffset + 1, "pop", [
    registerOperandFromOpcode(value, opcode.popR32Base)
  ]);
}

function decodePushImm32(context: DecodeContext): DecodedInstruction {
  ensureDecodeBytes(context, context.opcodeOffset + 1, 4);

  return decodedInstruction(context, context.opcodeOffset + 5, "push", [
    { kind: "imm32", value: context.reader.readU32LE(context.opcodeOffset + 1) }
  ]);
}

function decodePushImm8(context: DecodeContext): DecodedInstruction {
  ensureDecodeBytes(context, context.opcodeOffset + 1, 1);

  const value = context.reader.readU8(context.opcodeOffset + 1);

  return decodedInstruction(context, context.opcodeOffset + 2, "push", [
    { kind: "imm8", value, signedValue: signedImm8(value) }
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
    const operands = readRm32Operands(context);

    if (operands === undefined) {
      return unsupportedInstruction(context, context.opcodeOffset + 2);
    }

    return decodedInstruction(context, context.opcodeOffset + 1 + operands.byteLength, mnemonic, [
      operands.rm,
      operands.reg
    ]);
  };
}

function decodeR32Rm32(mnemonic: Mnemonic, sourceKind?: Operand["kind"]): OpcodeHandler {
  return (context) => {
    const operands = readRm32Operands(context);

    if (operands === undefined || (sourceKind !== undefined && operands.rm.kind !== sourceKind)) {
      return unsupportedInstruction(context, context.opcodeOffset + 2);
    }

    return decodedInstruction(context, context.opcodeOffset + 1 + operands.byteLength, mnemonic, [
      operands.reg,
      operands.rm
    ]);
  };
}

function decodeGroup81Rm32(context: DecodeContext): DecodedInstruction {
  const operands = readRm32Operands(context);

  if (operands === undefined) {
    return unsupportedInstruction(context, context.opcodeOffset + 2);
  }

  const immediateOffset = context.opcodeOffset + 1 + operands.byteLength;

  ensureDecodeBytes(context, immediateOffset, 4);

  const handler = group81Handlers[operands.regField];

  if (handler === undefined) {
    return unsupportedInstruction(context, immediateOffset + 4);
  }

  return handler(context, operands, immediateOffset);
}

function decodeGroup81Rm32Imm32(mnemonic: Extract<Mnemonic, "add" | "sub" | "cmp">): GroupRm32Handler {
  return (context, operands, immediateOffset) =>
    decodedInstruction(context, immediateOffset + 4, mnemonic, [
      operands.rm,
      { kind: "imm32", value: context.reader.readU32LE(immediateOffset) }
    ]);
}

function decodeGroup83Rm32(context: DecodeContext): DecodedInstruction {
  const operands = readRm32Operands(context);

  if (operands === undefined) {
    return unsupportedInstruction(context, context.opcodeOffset + 2);
  }

  const immediateOffset = context.opcodeOffset + 1 + operands.byteLength;

  ensureDecodeBytes(context, immediateOffset, 1);

  const handler = group83Handlers[operands.regField];

  if (handler === undefined) {
    return unsupportedInstruction(context, immediateOffset + 1);
  }

  return handler(context, operands, immediateOffset);
}

function decodeGroup83Rm32Imm8(mnemonic: Extract<Mnemonic, "add" | "sub" | "cmp">): GroupRm32Handler {
  return (context, operands, immediateOffset) => {
    const value = context.reader.readU8(immediateOffset);

    return decodedInstruction(context, immediateOffset + 1, mnemonic, [
      operands.rm,
      { kind: "imm8", value, signedValue: signedImm8(value) }
    ]);
  };
}

function decodeMovR32Imm32(context: DecodeContext, value: number): DecodedInstruction {
  ensureDecodeBytes(context, context.opcodeOffset + 1, 4);

  return decodedInstruction(context, context.opcodeOffset + movR32Imm32Length, "mov", [
    registerOperandFromOpcode(value, opcode.movR32Imm32Base),
    { kind: "imm32", value: context.reader.readU32LE(context.opcodeOffset + 1) }
  ]);
}

function registerOperandFromOpcode(value: number, base: number): Operand {
  const reg = reg32[value - base];

  if (reg === undefined) {
    throw new Error(`register encoding out of range for opcode 0x${value.toString(16)}`);
  }

  return { kind: "reg32", reg };
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

function readRm32Operands(context: DecodeContext): ModRmOperands | undefined {
  ensureDecodeBytes(context, context.opcodeOffset + 1, 1);

  const offset = context.opcodeOffset + 1;
  const modrmValue = context.reader.readU8(offset);

  if (rm32ModRmHasSib(modrmValue)) {
    ensureDecodeBytes(context, offset + 1, 1);
  }

  const byteLength = rm32ModRmByteLengthAt(context.reader, offset);

  if (byteLength === undefined) {
    return undefined;
  }

  ensureDecodeBytes(context, offset, byteLength);

  const modrm = decodeRm32ModRm(context.reader, offset);

  if (modrm === undefined) {
    return undefined;
  }

  return {
    regField: modrm.regField,
    reg: { kind: "reg32", reg: modrm.reg },
    rm: modrm.rm,
    byteLength: modrm.byteLength
  };
}
