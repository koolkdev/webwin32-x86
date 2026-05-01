import type { SirProgram } from "../../arch/x86/sir/types.js";
import type { JitOperandBinding } from "./operand-bindings.js";

export type JitSirBlockInstruction = Readonly<{
  instructionId: string;
  eip: number;
  nextEip: number;
  nextMode: "continue" | "exit";
}>;

export type JitSirBlock = Readonly<{
  sir: SirProgram;
  operands: readonly JitOperandBinding[];
  instructions: readonly JitSirBlockInstruction[];
}>;
