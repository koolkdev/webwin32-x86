import { form, mnemonic } from "#x86/isa/schema/builders.js";
import { imm, implicitReg, modrmReg, modrmRm } from "#x86/isa/schema/operands.js";
import { cmpSemantic } from "#x86/isa/semantics/cmp.js";
import { testSemantic } from "#x86/isa/semantics/test.js";

export const CMP = mnemonic("cmp", [
  // 39 /r: CMP r/m32, r32
  form("rm32_r32", {
    opcode: [0x39],
    operands: [modrmRm("rm32"), modrmReg("reg32")],
    format: { syntax: "cmp {0}, {1}" },
    semantics: cmpSemantic()
  }),
  // 3B /r: CMP r32, r/m32
  form("r32_rm32", {
    opcode: [0x3b],
    operands: [modrmReg("reg32"), modrmRm("rm32")],
    format: { syntax: "cmp {0}, {1}" },
    semantics: cmpSemantic()
  }),
  // 3D id: CMP EAX, imm32
  form("eax_imm32", {
    opcode: [0x3d],
    operands: [implicitReg("eax"), imm(32)],
    format: { syntax: "cmp {0}, {1}" },
    semantics: cmpSemantic()
  }),
  // 81 /7 id: CMP r/m32, imm32
  form("rm32_imm32", {
    opcode: [0x81],
    modrm: { match: { reg: 7 } },
    operands: [modrmRm("rm32"), imm(32)],
    format: { syntax: "cmp {0}, {1}" },
    semantics: cmpSemantic()
  }),
  // 83 /7 ib: CMP r/m32, sign-extended imm8
  form("rm32_imm8", {
    opcode: [0x83],
    modrm: { match: { reg: 7 } },
    operands: [modrmRm("rm32"), imm(8, "sign")],
    format: { syntax: "cmp {0}, {1}" },
    semantics: cmpSemantic()
  })
]);

export const TEST = mnemonic("test", [
  // 85 /r: TEST r/m32, r32
  form("rm32_r32", {
    opcode: [0x85],
    operands: [modrmRm("rm32"), modrmReg("reg32")],
    format: { syntax: "test {0}, {1}" },
    semantics: testSemantic()
  }),
  // A9 id: TEST EAX, imm32
  form("eax_imm32", {
    opcode: [0xa9],
    operands: [implicitReg("eax"), imm(32)],
    format: { syntax: "test {0}, {1}" },
    semantics: testSemantic()
  }),
  // F7 /0 id: TEST r/m32, imm32
  form("rm32_imm32", {
    opcode: [0xf7],
    modrm: { match: { reg: 0 } },
    operands: [modrmRm("rm32"), imm(32)],
    format: { syntax: "test {0}, {1}" },
    semantics: testSemantic()
  })
]);
