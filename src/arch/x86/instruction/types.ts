import type { JccCondition } from "./condition.js";
import type { Mnemonic } from "./mnemonic.js";
import type { Prefix } from "./prefix.js";

export const reg32 = ["eax", "ecx", "edx", "ebx", "esp", "ebp", "esi", "edi"] as const;

export type Reg32 = (typeof reg32)[number];

export type Operand =
  | Readonly<{ kind: "reg32"; reg: Reg32 }>
  | Readonly<{ kind: "imm8"; value: number; signedValue: number }>
  | Readonly<{ kind: "imm16"; value: number }>
  | Readonly<{ kind: "imm32"; value: number }>
  | Readonly<{ kind: "rel8"; displacement: number; target: number }>
  | Readonly<{ kind: "rel32"; displacement: number; target: number }>
  | Mem32Operand;

export type Mem32Operand = Readonly<{
  kind: "mem32";
  base?: Reg32;
  index?: Reg32;
  scale: 1 | 2 | 4 | 8;
  disp: number;
}>;

export type DecodedInstruction = Readonly<{
  address: number;
  length: number;
  mnemonic: Mnemonic;
  operands: readonly Operand[];
  raw: readonly number[];
  prefixes: readonly Prefix[];
  condition?: JccCondition;
}>;
