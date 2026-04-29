import type { Reg32 } from "../../instruction/types.js";
import type { ImmediateExtension, OperandSpec } from "./types.js";

export function modrmReg(name: string, type: "reg32"): OperandSpec {
  return { name, kind: "modrm.reg", type };
}

export function modrmRm(name: string, type: "rm32" | "m32"): OperandSpec {
  return { name, kind: "modrm.rm", type };
}

export function opReg(name: string): OperandSpec {
  return { name, kind: "opcode.reg", type: "reg32" };
}

export function implicitReg(name: string, reg: Reg32): OperandSpec {
  return { name, kind: "implicit.reg", reg, type: "reg32" };
}

export function imm(name: string, width: 8 | 16 | 32, extension?: ImmediateExtension): OperandSpec {
  if (extension === undefined) {
    return { name, kind: "imm", width };
  }

  return { name, kind: "imm", width, extension };
}

export function rel(name: string, width: 8 | 32): OperandSpec {
  return { name, kind: "rel", width };
}
