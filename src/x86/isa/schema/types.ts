import type { Reg32 } from "#x86/isa/types.js";

export type Reg3 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type FixedHighBits = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type OpcodePathPart =
  | number
  | Readonly<{
      byte: number;
      bits?: FixedHighBits;
    }>;

export type OpcodePath = readonly OpcodePathPart[];

export type ImmediateExtension = "sign" | "zero";

export type OperandSpec =
  | Readonly<{ kind: "modrm.reg"; type: "reg32" }>
  | Readonly<{ kind: "modrm.rm"; type: "rm32" }>
  | Readonly<{ kind: "modrm.rm"; type: "m32" }>
  | Readonly<{ kind: "opcode.reg"; type: "reg32" }>
  | Readonly<{ kind: "implicit.reg"; reg: Reg32; type: "reg32" }>
  | Readonly<{ kind: "imm"; width: 8 | 16 | 32; extension?: ImmediateExtension }>
  | Readonly<{ kind: "rel"; width: 8 | 32 }>;

export type ModRmMatch = Readonly<{
  mod?: Reg3;
  reg?: Reg3;
  rm?: Reg3;
}>;

export type InstructionFormat = Readonly<{
  syntax: string;
}>;

export type InstructionSpec<TSemantics = unknown> = Readonly<{
  id: string;
  mnemonic: string;
  opcode: OpcodePath;
  modrm?: Readonly<{
    match?: ModRmMatch;
  }>;
  operands?: readonly OperandSpec[];
  format: InstructionFormat;
  semantics: TSemantics;
}>;

export type InstructionFormSpec<TSemantics = unknown> = Omit<InstructionSpec<TSemantics>, "id" | "mnemonic">;

export type InstructionForm<TSemantics = unknown> = Readonly<{
  formId: string;
  spec: InstructionFormSpec<TSemantics>;
}>;

export type InstructionMnemonic<TSemantics = unknown> = Readonly<{
  mnemonic: string;
  forms: readonly InstructionForm<TSemantics>[];
}>;

export type IsaDefinition<TSemantics = unknown> = Readonly<{
  name: string;
  mnemonics: readonly InstructionMnemonic<TSemantics>[];
}>;

export type DefinedIsa<TSemantics = unknown> = Readonly<{
  name: string;
  instructions: readonly InstructionSpec<TSemantics>[];
}>;

export type ExpandedInstructionSpec<TSemantics = unknown> = Readonly<{
  spec: InstructionSpec<TSemantics>;
  opcode: readonly number[];
  opcodeLowBits?: number;
}>;
