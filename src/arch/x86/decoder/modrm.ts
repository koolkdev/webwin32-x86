import type { ByteReader } from "./byte-reader.js";
import { signedImm8, signedImm32 } from "./immediate.js";
import { reg32, type Mem32Operand, type Reg32 } from "../instruction/types.js";

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

export function rm32ModRmByteLength(value: number): number | undefined {
  const mod = value >>> 6;
  const rmField = value & 0b111;

  switch (mod) {
    case 0:
      if (rmField === 0b100) {
        return undefined;
      }

      return rmField === 0b101 ? 5 : 1;
    case 1:
      return rmField === 0b100 ? undefined : 2;
    case 2:
      return rmField === 0b100 ? undefined : 5;
    case 3:
      return 1;
    default:
      throw new Error(`ModRM mod field out of range: ${mod}`);
  }
}

export function decodeRm32ModRm(reader: ByteReader, offset: number): Rm32ModRm | undefined {
  const value = reader.readU8(offset);
  const mod = value >>> 6;
  const regField = (value >>> 3) & 0b111;
  const rmField = value & 0b111;
  const byteLength = rm32ModRmByteLength(value);

  if (byteLength === undefined) {
    return undefined;
  }

  if (mod === 3) {
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
  if (mod === 0 && rmField === 0b101) {
    return { kind: "mem32", scale: 1, disp: reader.readU32LE(offset + 1) };
  }

  const base = register(rmField);

  if (mod === 1) {
    return mem32(base, signedImm8(reader.readU8(offset + 1)));
  }

  if (mod === 2) {
    return mem32(base, signedImm32(reader.readU32LE(offset + 1)));
  }

  return mem32(base, 0);
}

function mem32(base: Reg32, disp: number): Mem32Operand {
  return { kind: "mem32", base, scale: 1, disp };
}

function register(value: number): Reg32 {
  const reg = reg32[value & 0b111];

  if (reg === undefined) {
    throw new Error(`register encoding out of range for ModRM byte 0x${value.toString(16)}`);
  }

  return reg;
}
