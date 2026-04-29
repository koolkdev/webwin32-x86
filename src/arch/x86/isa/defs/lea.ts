import { form, mnemonic } from "../schema/builders.js";
import { modrmReg, modrmRm } from "../schema/operands.js";
import { leaSemantic } from "../semantics/lea.js";

export const LEA = mnemonic("lea", [
  // 8D /r: LEA r32, m32
  form("r32_m32", {
    opcode: [0x8d],
    operands: [modrmReg("reg32"), modrmRm("m32")],
    format: { syntax: "lea {0}, {1}" },
    semantics: leaSemantic()
  })
]);
