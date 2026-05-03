import type { IrOp, StorageRef, ValueRef } from "./types.js";

export type IrValueUseRole = "condition" | "value";

export function visitIrOpValueRefs(
  op: IrOp,
  visit: (value: ValueRef, role: IrValueUseRole) => void
): void {
  switch (op.op) {
    case "get32":
      visitIrStorageValueRefs(op.source, visit);
      return;
    case "set32":
      visitIrStorageValueRefs(op.target, visit);
      visit(op.value, "value");
      return;
    case "set32.if":
      visit(op.condition, "condition");
      visitIrStorageValueRefs(op.target, visit);
      visit(op.value, "value");
      return;
    case "address32":
      return;
    case "const32":
      return;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      visit(op.a, "value");
      visit(op.b, "value");
      return;
    case "flags.set":
      for (const value of Object.values(op.inputs)) {
        visit(value, "value");
      }
      return;
    case "flagProducer.condition":
      for (const value of Object.values(op.inputs)) {
        visit(value, "value");
      }
      return;
    case "flags.materialize":
    case "flags.boundary":
    case "aluFlags.condition":
    case "next":
      return;
    case "jump":
      visit(op.target, "value");
      return;
    case "conditionalJump":
      visit(op.condition, "condition");
      visit(op.taken, "value");
      visit(op.notTaken, "value");
      return;
    case "hostTrap":
      visit(op.vector, "value");
      return;
  }
}

export function visitIrStorageValueRefs(
  storage: StorageRef,
  visit: (value: ValueRef, role: IrValueUseRole) => void
): void {
  if (storage.kind === "mem") {
    visit(storage.address, "value");
  }
}
