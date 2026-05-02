import type { Mem32Operand, Reg32 } from "../types.js";
import type { SemanticTemplate } from "../../ir/model/types.js";
import type { InstructionSpec, ImmediateExtension } from "../schema/types.js";

export type IsaOperandBinding =
  | Readonly<{ kind: "reg32"; reg: Reg32 }>
  | Mem32Operand
  | Readonly<{
      kind: "imm32";
      value: number;
      encodedWidth: 8 | 16 | 32;
      extension?: ImmediateExtension;
    }>
  | Readonly<{
      kind: "relTarget";
      width: 8 | 32;
      displacement: number;
      target: number;
    }>;

export type IsaDecodedInstruction = Readonly<{
  spec: InstructionSpec<SemanticTemplate>;
  address: number;
  length: number;
  nextEip: number;
  operands: readonly IsaOperandBinding[];
  raw: readonly number[];
}>;

export type IsaDecodeResult =
  | Readonly<{ kind: "ok"; instruction: IsaDecodedInstruction }>
  | Readonly<{
      kind: "unsupported";
      address: number;
      length: number;
      raw: readonly number[];
      unsupportedByte?: number;
    }>;
