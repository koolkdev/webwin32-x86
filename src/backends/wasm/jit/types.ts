import type { IrBody } from "#x86/ir/model/types.js";
import type { JitOperandBinding } from "./lowering/operand-bindings.js";

export type JitIrBlockInstructionMetadata = Readonly<{
  instructionId: string;
  eip: number;
  nextEip: number;
  nextMode: "continue" | "exit";
}>;

export type JitIrBlockInstruction = JitIrBlockInstructionMetadata & Readonly<{
  operands: readonly JitOperandBinding[];
  ir: IrBody;
}>;

export type JitIrBlock = Readonly<{
  instructions: readonly JitIrBlockInstruction[];
}>;

export type JitIrLoweringBlock = Readonly<{
  ir: IrBody;
  operands: readonly JitOperandBinding[];
  instructions: readonly JitIrBlockInstructionMetadata[];
}>;
