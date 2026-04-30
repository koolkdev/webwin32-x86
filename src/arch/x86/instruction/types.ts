import type { JccCondition } from "./condition.js";
import type { Mnemonic } from "./mnemonic.js";
import type { Prefix } from "./prefix.js";
import type { Mem32Operand, Reg32 } from "../isa/types.js";

export { reg32 } from "../isa/types.js";
export type { Mem32Operand, Reg32 } from "../isa/types.js";

export type Operand =
  | Readonly<{ kind: "reg32"; reg: Reg32 }>
  | Readonly<{ kind: "imm8"; value: number; signedValue: number }>
  | Readonly<{ kind: "imm16"; value: number }>
  | Readonly<{ kind: "imm32"; value: number }>
  | Readonly<{ kind: "rel8"; displacement: number; target: number }>
  | Readonly<{ kind: "rel32"; displacement: number; target: number }>
  | Mem32Operand;

export type DecodedInstruction = Readonly<{
  address: number;
  length: number;
  mnemonic: Mnemonic;
  operands: readonly Operand[];
  raw: readonly number[];
  prefixes: readonly Prefix[];
  condition?: JccCondition;
}>;
