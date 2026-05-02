import type { Reg32 } from "../types.js";
import type { ImmediateExtension, OperandSpec } from "./types.js";

export function modrmReg(type: "reg32"): OperandSpec {
  return { kind: "modrm.reg", type };
}

export function modrmRm(type: "rm32" | "m32"): OperandSpec {
  return { kind: "modrm.rm", type };
}

export function opReg(): OperandSpec {
  return { kind: "opcode.reg", type: "reg32" };
}

export function implicitReg(reg: Reg32): OperandSpec {
  return { kind: "implicit.reg", reg, type: "reg32" };
}

export function imm(width: 8 | 16 | 32, extension?: ImmediateExtension): OperandSpec {
  if (extension === undefined) {
    return { kind: "imm", width };
  }

  return { kind: "imm", width, extension };
}

export function rel(width: 8 | 32): OperandSpec {
  return { kind: "rel", width };
}
