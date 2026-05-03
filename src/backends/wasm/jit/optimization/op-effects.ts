import type { IrOp, StorageRef } from "#x86/ir/model/types.js";
import { ExitReason, type ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitOperandBinding } from "#backends/wasm/jit/lowering/operand-bindings.js";

export function jitMemoryFaultReason(
  op: IrOp,
  operands: readonly JitOperandBinding[]
): ExitReasonValue | undefined {
  switch (op.op) {
    case "get32":
      return storageMayAccessMemory(op.source, operands) ? ExitReason.MEMORY_READ_FAULT : undefined;
    case "set32":
      return storageMayAccessMemory(op.target, operands) ? ExitReason.MEMORY_WRITE_FAULT : undefined;
    default:
      return undefined;
  }
}

export function requiredJitOperandBinding(
  operands: readonly JitOperandBinding[],
  index: number
): JitOperandBinding {
  const operand = operands[index];

  if (operand === undefined) {
    throw new Error(`missing JIT operand while analyzing JIT IR block: ${index}`);
  }

  return operand;
}

function storageMayAccessMemory(storage: StorageRef, operands: readonly JitOperandBinding[]): boolean {
  switch (storage.kind) {
    case "mem":
      return true;
    case "reg":
      return false;
    case "operand":
      return requiredJitOperandBinding(operands, storage.index).kind === "static.mem32";
  }
}
