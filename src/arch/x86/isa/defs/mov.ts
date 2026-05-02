import { form, mnemonic } from "../schema/builders.js";
import { imm, modrmReg, modrmRm, opReg } from "../schema/operands.js";
import { opcodePlusReg } from "../schema/opcodes.js";
import { movSemantic } from "../semantics/mov.js";

export const MOV = mnemonic("mov", [
  // 8B /r: MOV r32, r/m32
  form("r32_rm32", {
    opcode: [0x8b],
    operands: [modrmReg("reg32"), modrmRm("rm32")],
    format: { syntax: "mov {0}, {1}" },
    semantics: movSemantic()
  }),
  // 89 /r: MOV r/m32, r32
  form("rm32_r32", {
    opcode: [0x89],
    operands: [modrmRm("rm32"), modrmReg("reg32")],
    format: { syntax: "mov {0}, {1}" },
    semantics: movSemantic()
  }),
  // C7 /0 id: MOV r/m32, imm32
  form("rm32_imm32", {
    opcode: [0xc7],
    modrm: { match: { reg: 0 } },
    operands: [modrmRm("rm32"), imm(32)],
    format: { syntax: "mov {0}, {1}" },
    semantics: movSemantic()
  }),
  // B8+rd id: MOV r32, imm32
  form("r32_imm32", {
    opcode: [opcodePlusReg(0xb8)],
    operands: [opReg(), imm(32)],
    format: { syntax: "mov {0}, {1}" },
    semantics: movSemantic()
  })
]);
