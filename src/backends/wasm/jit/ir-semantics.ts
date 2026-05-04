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
import type { StorageRef, ValueRef, VarRef } from "#x86/ir/model/types.js";
import type { IrExpressionInputBlock, IrExpressionInputOp } from "#backends/wasm/lowering/expressions.js";
import type { JitIrBody, JitIrOp } from "./types.js";

export function jitIrOpResult(op: JitIrOp): IrOpResult {
  switch (op.op) {
    case "flagProducer.condition":
      return { kind: "value", dst: op.dst, sideEffect: "none" };
    case "set32.materialize":
      return { kind: "none" };
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
    case "flagProducer.condition":
    case "set32.materialize":
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
    case "flagProducer.condition":
      for (const name of flagProducerConditionInputNames(op)) {
        visit(requiredFlagProducerConditionInput(op, name), "value");
      }
      return;
    case "set32.materialize":
      if (op.target.kind === "mem") {
        visit(op.target.address, "value");
      }
      visit(op.value, "value");
      return;
    default:
      visitIrOpValueRefs(op, visit);
      return;
  }
}

export function jitIrOpStorageUses(op: JitIrOp): readonly IrStorageUse[] {
  switch (op.op) {
    case "flagProducer.condition":
      return [];
    case "set32.materialize":
      return [{ storage: op.target, role: "write" }];
    default:
      return irOpStorageUses(op);
  }
}

export function jitIrOpStorageReads(op: JitIrOp): readonly StorageRef[] {
  switch (op.op) {
    case "flagProducer.condition":
    case "set32.materialize":
      return [];
    default:
      return irOpStorageReads(op);
  }
}

export function jitIrOpStorageWrites(op: JitIrOp): readonly StorageRef[] {
  switch (op.op) {
    case "flagProducer.condition":
      return [];
    case "set32.materialize":
      return [op.target];
    default:
      return irOpStorageWrites(op);
  }
}

export function lowerableJitIrBlock(block: JitIrBody): IrExpressionInputBlock {
  return block.map(lowerableJitIrOp);
}

function lowerableJitIrOp(op: JitIrOp): IrExpressionInputOp {
  switch (op.op) {
    case "set32.materialize":
      return { op: "set32", target: op.target, value: op.value, role: "registerMaterialization" };
    case "set32":
      return { op: "set32", target: op.target, value: op.value };
    default:
      return op;
  }
}
