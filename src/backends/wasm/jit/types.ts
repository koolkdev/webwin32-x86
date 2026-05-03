import type {
  ConditionCode,
  FlagMask,
  FlagProducerName,
  IrOp,
  RegRef,
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

export type JitOptimizedIrPreludeOp = Extract<
  IrOp,
  { op: "const32" | "i32.add" | "i32.sub" | "i32.xor" | "i32.or" | "i32.and" }
> |
  (Extract<IrOp, { op: "get32" }> & Readonly<{ source: RegRef }>) |
  (Extract<IrOp, { op: "set32" }> & Readonly<{ target: RegRef }>);

export type JitOptimizedIrBlockInstruction = JitIrBlockInstructionMetadata & Readonly<{
  operands: readonly JitOperandBinding[];
  prelude: readonly JitOptimizedIrPreludeOp[];
  ir: JitIrBody;
}>;

export type JitOptimizedIrBlock = Readonly<{
  instructions: readonly JitOptimizedIrBlockInstruction[];
}>;
