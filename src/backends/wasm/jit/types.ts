import type {
  IrOp,
  StorageRef,
  ValueRef,
  VarRef
} from "#x86/ir/model/types.js";
import type { IrFlagProducerConditionDescriptor } from "#x86/ir/model/flag-conditions.js";
import type { JitOperandBinding } from "./lowering/operand-bindings.js";

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

export type JitRegisterMaterializationOp = Readonly<{
  op: "set32.materialize";
  target: StorageRef;
  value: ValueRef;
}>;

export type JitIrOp =
  | IrOp
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
