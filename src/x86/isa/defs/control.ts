import type { ConditionCode, SemanticTemplate } from "#x86/ir/model/types.js";
import { form, mnemonic, type InstructionForm, type InstructionMnemonic } from "#x86/isa/schema/builders.js";
import { imm, modrmRm, rel } from "#x86/isa/schema/operands.js";
import { callSemantic, jccSemantic, jmpSemantic, retImmSemantic, retSemantic } from "#x86/isa/semantics/control.js";

export const JMP = mnemonic("jmp", [
  // EB cb: JMP rel8
  form("rel8", {
    opcode: [0xeb],
    operands: [rel(8)],
    format: { syntax: "jmp {0}" },
    semantics: jmpSemantic()
  }),
  // E9 cd: JMP rel32
  form("rel32", {
    opcode: [0xe9],
    operands: [rel(32)],
    format: { syntax: "jmp {0}" },
    semantics: jmpSemantic()
  }),
  // FF /4: JMP r/m32
  form("rm32", {
    opcode: [0xff],
    modrm: { match: { reg: 4 } },
    operands: [modrmRm("rm32")],
    format: { syntax: "jmp {0}" },
    semantics: jmpSemantic()
  })
]);

export const CALL = mnemonic("call", [
  // E8 cd: CALL rel32
  form("rel32", {
    opcode: [0xe8],
    operands: [rel(32)],
    format: { syntax: "call {0}" },
    semantics: callSemantic()
  }),
  // FF /2: CALL r/m32
  form("rm32", {
    opcode: [0xff],
    modrm: { match: { reg: 2 } },
    operands: [modrmRm("rm32")],
    format: { syntax: "call {0}" },
    semantics: callSemantic()
  })
]);

export const RET = mnemonic("ret", [
  // C3: RET
  form("near", {
    opcode: [0xc3],
    format: { syntax: "ret" },
    semantics: retSemantic()
  }),
  // C2 iw: RET imm16
  form("imm16", {
    opcode: [0xc2],
    operands: [imm(16, "zero")],
    format: { syntax: "ret {0}" },
    semantics: retImmSemantic()
  })
]);

type JccDescriptor = Readonly<{
  opcodeLow: number;
  mnemonicName: string;
  cc: ConditionCode;
}>;

export const JCC_DESCRIPTORS = [
  // 70 cb / 0F 80 cd: JO rel8/rel32
  { opcodeLow: 0x0, mnemonicName: "jo", cc: "O" },
  // 71 cb / 0F 81 cd: JNO rel8/rel32
  { opcodeLow: 0x1, mnemonicName: "jno", cc: "NO" },
  // 72 cb / 0F 82 cd: JB rel8/rel32
  { opcodeLow: 0x2, mnemonicName: "jb", cc: "B" },
  // 73 cb / 0F 83 cd: JAE rel8/rel32
  { opcodeLow: 0x3, mnemonicName: "jae", cc: "AE" },
  // 74 cb / 0F 84 cd: JE rel8/rel32
  { opcodeLow: 0x4, mnemonicName: "je", cc: "E" },
  // 75 cb / 0F 85 cd: JNE rel8/rel32
  { opcodeLow: 0x5, mnemonicName: "jne", cc: "NE" },
  // 76 cb / 0F 86 cd: JBE rel8/rel32
  { opcodeLow: 0x6, mnemonicName: "jbe", cc: "BE" },
  // 77 cb / 0F 87 cd: JA rel8/rel32
  { opcodeLow: 0x7, mnemonicName: "ja", cc: "A" },
  // 78 cb / 0F 88 cd: JS rel8/rel32
  { opcodeLow: 0x8, mnemonicName: "js", cc: "S" },
  // 79 cb / 0F 89 cd: JNS rel8/rel32
  { opcodeLow: 0x9, mnemonicName: "jns", cc: "NS" },
  // 7A cb / 0F 8A cd: JP rel8/rel32
  { opcodeLow: 0xa, mnemonicName: "jp", cc: "P" },
  // 7B cb / 0F 8B cd: JNP rel8/rel32
  { opcodeLow: 0xb, mnemonicName: "jnp", cc: "NP" },
  // 7C cb / 0F 8C cd: JL rel8/rel32
  { opcodeLow: 0xc, mnemonicName: "jl", cc: "L" },
  // 7D cb / 0F 8D cd: JGE rel8/rel32
  { opcodeLow: 0xd, mnemonicName: "jge", cc: "GE" },
  // 7E cb / 0F 8E cd: JLE rel8/rel32
  { opcodeLow: 0xe, mnemonicName: "jle", cc: "LE" },
  // 7F cb / 0F 8F cd: JG rel8/rel32
  { opcodeLow: 0xf, mnemonicName: "jg", cc: "G" }
] as const satisfies readonly JccDescriptor[];

export const JCC: readonly InstructionMnemonic<SemanticTemplate>[] = JCC_DESCRIPTORS.map(jccMnemonic);

function jccMnemonic(descriptor: JccDescriptor): InstructionMnemonic<SemanticTemplate> {
  return mnemonic(descriptor.mnemonicName, [jccRel8(descriptor), jccRel32(descriptor)]);
}

function jccRel8(descriptor: JccDescriptor): InstructionForm<SemanticTemplate> {
  return form("rel8", {
    opcode: [0x70 + descriptor.opcodeLow],
    operands: [rel(8)],
    format: { syntax: `${descriptor.mnemonicName} {0}` },
    semantics: jccSemantic(descriptor.cc)
  });
}

function jccRel32(descriptor: JccDescriptor): InstructionForm<SemanticTemplate> {
  return form("rel32", {
    opcode: [0x0f, 0x80 + descriptor.opcodeLow],
    operands: [rel(32)],
    format: { syntax: `${descriptor.mnemonicName} {0}` },
    semantics: jccSemantic(descriptor.cc)
  });
}
