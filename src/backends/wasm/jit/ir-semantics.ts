import {
  flagProducerConditionInputNames,
  requiredFlagProducerConditionInput
} from "#x86/ir/model/flag-conditions.js";
import {
  irOpDst,
  irOpResult,
  irOpIsTerminator,
  irOpStorageUses,
  irOpStorageReads,
  irOpStorageWrites,
  visitIrOpValueRefs,
  type IrOpResult,
  type IrStorageUse,
  type IrValueUse,
  type IrValueUseRole
} from "#x86/ir/model/op-semantics.js";
import type { IrBlock, IrOp, StorageRef, ValueRef, VarRef } from "#x86/ir/model/types.js";
import type { JitIrBody, JitIrOp } from "./types.js";

export function jitIrOpResult(op: JitIrOp): IrOpResult {
  switch (op.op) {
    case "jit.flagCondition":
      return { kind: "value", dst: op.dst, sideEffect: "none" };
    default:
      return irOpResult(op);
  }
}

export function jitIrOpDst(op: JitIrOp): VarRef | undefined {
  const result = jitIrOpResult(op);

  return result.kind === "value" ? result.dst : undefined;
}

export function jitIrOpIsTerminator(op: JitIrOp): boolean {
  switch (op.op) {
    case "jit.flagCondition":
      return false;
    default:
      return irOpIsTerminator(op);
  }
}

export function jitIrOpValueUses(op: JitIrOp): readonly IrValueUse[] {
  const uses: IrValueUse[] = [];

  visitJitIrOpValueRefs(op, (value, role) => {
    uses.push({ value, role });
  });
  return uses;
}

export function visitJitIrOpValueRefs(
  op: JitIrOp,
  visit: (value: ValueRef, role: IrValueUseRole) => void
): void {
  switch (op.op) {
    case "jit.flagCondition":
      for (const name of flagProducerConditionInputNames(op)) {
        visit(requiredFlagProducerConditionInput(op, name), "value");
      }
      return;
    default:
      visitIrOpValueRefs(op, visit);
      return;
  }
}

export function jitIrOpStorageUses(op: JitIrOp): readonly IrStorageUse[] {
  switch (op.op) {
    case "jit.flagCondition":
      return [];
    default:
      return irOpStorageUses(op);
  }
}

export function jitIrOpStorageReads(op: JitIrOp): readonly StorageRef[] {
  switch (op.op) {
    case "jit.flagCondition":
      return [];
    default:
      return irOpStorageReads(op);
  }
}

export function jitIrOpStorageWrites(op: JitIrOp): readonly StorageRef[] {
  switch (op.op) {
    case "jit.flagCondition":
      return [];
    default:
      return irOpStorageWrites(op);
  }
}

export function lowerableJitIrBlock(block: JitIrBody): IrBlock {
  return block.map(lowerableJitIrOp);
}

function lowerableJitIrOp(op: JitIrOp): IrOp {
  switch (op.op) {
    case "jit.flagCondition":
      return {
        op: "flagProducer.condition",
        dst: op.dst,
        cc: op.cc,
        producer: op.producer,
        writtenMask: op.writtenMask,
        undefMask: op.undefMask,
        inputs: op.inputs
      };
    default:
      return op;
  }
}
