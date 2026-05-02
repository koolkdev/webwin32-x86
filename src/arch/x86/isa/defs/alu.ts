import { form, mnemonic } from "../schema/builders.js";
import { opcodePlusReg } from "../schema/opcodes.js";
import { imm, implicitReg, modrmReg, modrmRm, opReg } from "../schema/operands.js";
import { aluSemantic, incDecSemantic } from "../semantics/alu.js";

export const ADD = mnemonic("add", [
  // 01 /r: ADD r/m32, r32
  form("rm32_r32", {
    opcode: [0x01],
    operands: [modrmRm("rm32"), modrmReg("reg32")],
    format: { syntax: "add {0}, {1}" },
    semantics: aluSemantic("add", 32)
  }),
  // 03 /r: ADD r32, r/m32
  form("r32_rm32", {
    opcode: [0x03],
    operands: [modrmReg("reg32"), modrmRm("rm32")],
    format: { syntax: "add {0}, {1}" },
    semantics: aluSemantic("add", 32)
  }),
  // 05 id: ADD EAX, imm32
  form("eax_imm32", {
    opcode: [0x05],
    operands: [implicitReg("eax"), imm(32)],
    format: { syntax: "add {0}, {1}" },
    semantics: aluSemantic("add", 32)
  }),
  // 81 /0 id: ADD r/m32, imm32
  form("rm32_imm32", {
    opcode: [0x81],
    modrm: { match: { reg: 0 } },
    operands: [modrmRm("rm32"), imm(32)],
    format: { syntax: "add {0}, {1}" },
    semantics: aluSemantic("add", 32)
  }),
  // 83 /0 ib: ADD r/m32, sign-extended imm8
  form("rm32_imm8", {
    opcode: [0x83],
    modrm: { match: { reg: 0 } },
    operands: [modrmRm("rm32"), imm(8, "sign")],
    format: { syntax: "add {0}, {1}" },
    semantics: aluSemantic("add", 32)
  })
]);

export const SUB = mnemonic("sub", [
  // 29 /r: SUB r/m32, r32
  form("rm32_r32", {
    opcode: [0x29],
    operands: [modrmRm("rm32"), modrmReg("reg32")],
    format: { syntax: "sub {0}, {1}" },
    semantics: aluSemantic("sub", 32)
  }),
  // 2B /r: SUB r32, r/m32
  form("r32_rm32", {
    opcode: [0x2b],
    operands: [modrmReg("reg32"), modrmRm("rm32")],
    format: { syntax: "sub {0}, {1}" },
    semantics: aluSemantic("sub", 32)
  }),
  // 2D id: SUB EAX, imm32
  form("eax_imm32", {
    opcode: [0x2d],
    operands: [implicitReg("eax"), imm(32)],
    format: { syntax: "sub {0}, {1}" },
    semantics: aluSemantic("sub", 32)
  }),
  // 81 /5 id: SUB r/m32, imm32
  form("rm32_imm32", {
    opcode: [0x81],
    modrm: { match: { reg: 5 } },
    operands: [modrmRm("rm32"), imm(32)],
    format: { syntax: "sub {0}, {1}" },
    semantics: aluSemantic("sub", 32)
  }),
  // 83 /5 ib: SUB r/m32, sign-extended imm8
  form("rm32_imm8", {
    opcode: [0x83],
    modrm: { match: { reg: 5 } },
    operands: [modrmRm("rm32"), imm(8, "sign")],
    format: { syntax: "sub {0}, {1}" },
    semantics: aluSemantic("sub", 32)
  })
]);

export const XOR = mnemonic("xor", [
  // 31 /r: XOR r/m32, r32
  form("rm32_r32", {
    opcode: [0x31],
    operands: [modrmRm("rm32"), modrmReg("reg32")],
    format: { syntax: "xor {0}, {1}" },
    semantics: aluSemantic("xor", 32)
  }),
  // 33 /r: XOR r32, r/m32
  form("r32_rm32", {
    opcode: [0x33],
    operands: [modrmReg("reg32"), modrmRm("rm32")],
    format: { syntax: "xor {0}, {1}" },
    semantics: aluSemantic("xor", 32)
  }),
  // 35 id: XOR EAX, imm32
  form("eax_imm32", {
    opcode: [0x35],
    operands: [implicitReg("eax"), imm(32)],
    format: { syntax: "xor {0}, {1}" },
    semantics: aluSemantic("xor", 32)
  }),
  // 81 /6 id: XOR r/m32, imm32
  form("rm32_imm32", {
    opcode: [0x81],
    modrm: { match: { reg: 6 } },
    operands: [modrmRm("rm32"), imm(32)],
    format: { syntax: "xor {0}, {1}" },
    semantics: aluSemantic("xor", 32)
  }),
  // 83 /6 ib: XOR r/m32, sign-extended imm8
  form("rm32_imm8", {
    opcode: [0x83],
    modrm: { match: { reg: 6 } },
    operands: [modrmRm("rm32"), imm(8, "sign")],
    format: { syntax: "xor {0}, {1}" },
    semantics: aluSemantic("xor", 32)
  })
]);

export const INC = mnemonic("inc", [
  // 40+rd: INC r32
  form("r32", {
    opcode: [opcodePlusReg(0x40)],
    operands: [opReg()],
    format: { syntax: "inc {0}" },
    semantics: incDecSemantic("inc", 32)
  }),
  // FF /0: INC r/m32
  form("rm32", {
    opcode: [0xff],
    modrm: { match: { reg: 0 } },
    operands: [modrmRm("rm32")],
    format: { syntax: "inc {0}" },
    semantics: incDecSemantic("inc", 32)
  })
]);

export const DEC = mnemonic("dec", [
  // 48+rd: DEC r32
  form("r32", {
    opcode: [opcodePlusReg(0x48)],
    operands: [opReg()],
    format: { syntax: "dec {0}" },
    semantics: incDecSemantic("dec", 32)
  }),
  // FF /1: DEC r/m32
  form("rm32", {
    opcode: [0xff],
    modrm: { match: { reg: 1 } },
    operands: [modrmRm("rm32")],
    format: { syntax: "dec {0}" },
    semantics: incDecSemantic("dec", 32)
  })
]);
