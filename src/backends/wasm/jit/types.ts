import type {
  ConditionCode,
  FlagMask,
  FlagProducerName,
  IrOp,
  ValueRef,
  VarRef
} from "#x86/ir/model/types.js";
import type { JitOperandBinding } from "./lowering/operand-bindings.js";

export type JitIrBlockInstructionMetadata = Readonly<{
  instructionId: string;
  eip: number;
  nextEip: number;
  nextMode: "continue" | "exit";
}>;

export type JitFlagConditionOp = Readonly<{
  op: "jit.flagCondition";
  dst: VarRef;
  cc: ConditionCode;
  producer: FlagProducerName;
  writtenMask: FlagMask;
  undefMask: FlagMask;
  inputs: Readonly<Record<string, ValueRef>>;
}>;

export type JitRegisterMaterializationOp = Extract<IrOp, { op: "set32" }> & Readonly<{
  jitRole?: "registerMaterialization";
}>;

export type JitIrOp = Exclude<IrOp, Extract<IrOp, { op: "set32" }>> | JitRegisterMaterializationOp | JitFlagConditionOp;
export type JitIrBody = readonly JitIrOp[];

export type JitIrBlockInstruction = JitIrBlockInstructionMetadata & Readonly<{
  operands: readonly JitOperandBinding[];
  ir: JitIrBody;
}>;

export type JitIrBlock = Readonly<{
  instructions: readonly JitIrBlockInstruction[];
}>;
