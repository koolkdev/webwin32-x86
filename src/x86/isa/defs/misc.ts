import { form, mnemonic } from "#x86/isa/schema/builders.js";
import { imm } from "#x86/isa/schema/operands.js";
import { intSemantic, nopSemantic } from "#x86/isa/semantics/misc.js";

export const NOP = mnemonic("nop", [
  // 90: NOP
  form("near", {
    opcode: [0x90],
    format: { syntax: "nop" },
    semantics: nopSemantic()
  }),
  // 66 90: temporary NOP alias until xchg r16, r16 is modeled.
  form("operand_size_override", {
    opcode: [0x90],
    prefixes: { operandSize: "override" },
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
