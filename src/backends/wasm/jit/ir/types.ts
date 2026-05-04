import type {
  IrOp,
  StorageRef,
  ValueRef,
  VarRef
} from "#x86/ir/model/types.js";
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

export type JitSet32Role = "registerMaterialization";

export type JitSet32Op = Extract<IrOp, { op: "set" }> & Readonly<{
  role?: JitSet32Role;
}>;

export type JitRegisterMaterializationOp = JitSet32Op & Readonly<{
  role: "registerMaterialization";
}>;

export type JitIrOp =
  | Exclude<IrOp, Extract<IrOp, { op: "set" }>>
  | JitSet32Op
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
