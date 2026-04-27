import type { ByteReader } from "./byte-reader.js";
import { signedImm8, signedImm32 } from "./immediate.js";
import { reg32, type Mem32Operand, type Reg32 } from "../instruction/types.js";

type Scale = Mem32Operand["scale"];
type Sib = Readonly<{
  baseField: number;
  index: Reg32 | undefined;
  scale: Scale;
}>;

const modRegister = 0b11;
const sibRmField = 0b100;
const disp32RmField = 0b101;
const noIndexField = 0b100;
const sibScales = [1, 2, 4, 8] as const;

export type RegisterModRm = Readonly<{
  regField: number;
  reg: Reg32;
  rm: Reg32;
}>;

export type Rm32Operand = Readonly<{ kind: "reg32"; reg: Reg32 }> | Mem32Operand;

export type Rm32ModRm = Readonly<{
  regField: number;
  reg: Reg32;
  rm: Rm32Operand;
  byteLength: number;
}>;

export function decodeRegisterModRm(value: number): RegisterModRm | undefined {
  const mod = value >>> 6;

  if (mod !== 3) {
    return undefined;
  }

  return {
    regField: (value >>> 3) & 0b111,
    reg: register(value >>> 3),
    rm: register(value)
  };
}

export function rm32ModRmHasSib(value: number): boolean {
  return (value >>> 6) !== modRegister && (value & 0b111) === sibRmField;
}

export function rm32ModRmByteLengthAt(reader: ByteReader, offset: number): number {
  const value = reader.readU8(offset);
  const mod = value >>> 6;
  const rmField = value & 0b111;

  switch (mod) {
    case 0:
      if (rmField === sibRmField) {
        const sibBaseField = reader.readU8(offset + 1) & 0b111;

        return sibBaseField === disp32RmField ? 6 : 2;
      }

      return rmField === disp32RmField ? 5 : 1;
    case 1:
      return rmField === sibRmField ? 3 : 2;
    case 2:
      return rmField === sibRmField ? 6 : 5;
    case modRegister:
      return 1;
    default:
      throw new Error(`ModRM mod field out of range: ${mod}`);
  }
}

export function decodeRm32ModRm(reader: ByteReader, offset: number): Rm32ModRm {
  const value = reader.readU8(offset);
  const mod = value >>> 6;
  const regField = (value >>> 3) & 0b111;
  const rmField = value & 0b111;
  const byteLength = rm32ModRmByteLengthAt(reader, offset);

  if (mod === modRegister) {
    return {
      regField,
      reg: register(value >>> 3),
      rm: { kind: "reg32", reg: register(value) },
      byteLength
    };
  }

  return {
    regField,
    reg: register(value >>> 3),
    rm: decodeMem32(reader, offset, mod, rmField),
    byteLength
  };
}

function decodeMem32(reader: ByteReader, offset: number, mod: number, rmField: number): Mem32Operand {
  const sib = rmField === sibRmField ? decodeSib(reader.readU8(offset + 1)) : undefined;
  const displacementOffset = sib === undefined ? offset + 1 : offset + 2;

  switch (mod) {
    case 0:
      if (sib !== undefined) {
        const base = sib.baseField === disp32RmField ? undefined : register(sib.baseField);
        const disp = sib.baseField === disp32RmField ? reader.readU32LE(displacementOffset) : 0;

        return mem32(base, sib.index, sib.scale, disp);
      }

      return rmField === disp32RmField
        ? mem32(undefined, undefined, 1, reader.readU32LE(displacementOffset))
        : mem32(register(rmField), undefined, 1, 0);
    case 1:
      return mem32(memoryBase(rmField, sib), sib?.index, sib?.scale ?? 1, signedImm8(reader.readU8(displacementOffset)));
    case 2:
      return mem32(
        memoryBase(rmField, sib),
        sib?.index,
        sib?.scale ?? 1,
        signedImm32(reader.readU32LE(displacementOffset))
      );
    default:
      throw new Error(`ModRM memory mode out of range: ${mod}`);
  }
}

function mem32(base: Reg32 | undefined, index: Reg32 | undefined, scale: Scale, disp: number): Mem32Operand {
  const mem: { kind: "mem32"; base?: Reg32; index?: Reg32; scale: Scale; disp: number } = {
    kind: "mem32",
    scale: index === undefined ? 1 : scale,
    disp
  };

  if (base !== undefined) {
    mem.base = base;
  }

  if (index !== undefined) {
    mem.index = index;
  }

  return mem;
}

function decodeSib(value: number): Sib {
  return {
    baseField: value & 0b111,
    index: sibIndex(value),
    scale: sibScale(value)
  };
}

function memoryBase(rmField: number, sib: Sib | undefined): Reg32 {
  return register(sib === undefined ? rmField : sib.baseField);
}

function sibScale(value: number): Scale {
  const scale = sibScales[value >>> 6];

  if (scale === undefined) {
    throw new Error(`SIB scale field out of range for byte 0x${value.toString(16)}`);
  }

  return scale;
}

function sibIndex(value: number): Reg32 | undefined {
  const field = (value >>> 3) & 0b111;

  return field === noIndexField ? undefined : register(field);
}

function register(value: number): Reg32 {
  const reg = reg32[value & 0b111];

  if (reg === undefined) {
    throw new Error(`register encoding out of range for ModRM byte 0x${value.toString(16)}`);
  }

  return reg;
}
