import type { IrProgram } from "../../../x86/ir/types.js";
import type { JitOperandBinding } from "./lowering/operand-bindings.js";

export type JitIrBlockInstruction = Readonly<{
  instructionId: string;
  eip: number;
  nextEip: number;
  nextMode: "continue" | "exit";
}>;

export type JitIrBlock = Readonly<{
  ir: IrProgram;
  operands: readonly JitOperandBinding[];
  instructions: readonly JitIrBlockInstruction[];
}>;
