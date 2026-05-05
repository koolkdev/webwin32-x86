import type { IrOp, VarRef } from "#x86/ir/model/types.js";
import type { IrFlagProducerConditionDescriptor } from "#x86/ir/model/flag-conditions.js";
import type { JitOperandBinding } from "./operand-bindings.js";

export type JitIrBlockInstructionMetadata = Readonly<{
  instructionId: string;
  eip: number;
  nextEip: number;
  nextMode: "continue" | "exit";
}>;

export type JitFlagProducerConditionOp = IrFlagProducerConditionDescriptor & Readonly<{
  op: "flagProducer.condition";
  dst: VarRef;
}>;

export type JitSetRole = "registerMaterialization";
export type JitGetRole = "symbolicRead";

export type JitGetOp = Extract<IrOp, { op: "get" }> & Readonly<{
  role?: JitGetRole;
}>;

export type JitSetOp = Extract<IrOp, { op: "set" }> & Readonly<{
  role?: JitSetRole;
}>;

export type JitRegisterMaterializationOp = JitSetOp & Readonly<{
  role: "registerMaterialization";
}>;

export type JitIrOp =
  | Exclude<IrOp, Extract<IrOp, { op: "get" | "set" }>>
  | JitGetOp
  | JitSetOp
  | JitRegisterMaterializationOp
  | JitFlagProducerConditionOp;
export type JitIrBody = readonly JitIrOp[];

export type JitIrBlockInstruction = JitIrBlockInstructionMetadata & Readonly<{
  operands: readonly JitOperandBinding[];
  ir: JitIrBody;
}>;

export type JitIrBlock = Readonly<{
  instructions: readonly JitIrBlockInstruction[];
}>;
