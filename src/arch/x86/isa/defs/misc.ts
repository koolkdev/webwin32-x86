import { form, mnemonic } from "../schema/builders.js";
import { imm } from "../schema/operands.js";
import { intSemantic, nopSemantic } from "../semantics/misc.js";

export const NOP = mnemonic("nop", [
  // 90: NOP
  form("near", {
    opcode: [0x90],
    format: { syntax: "nop" },
    semantics: nopSemantic()
  })
]);

export const INT = mnemonic("int", [
  // CD ib: INT imm8
  form("imm8", {
    opcode: [0xcd],
    operands: [imm(8)],
    format: { syntax: "int {0}" },
    semantics: intSemantic()
  })
]);
