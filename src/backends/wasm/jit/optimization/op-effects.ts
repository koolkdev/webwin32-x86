import type { IrOp, StorageRef, ValueRef } from "#x86/ir/model/types.js";
import { ExitReason, type ExitReason as ExitReasonValue } from "#backends/wasm/exit.js";
import type { JitOperandBinding } from "#backends/wasm/jit/lowering/operand-bindings.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/types.js";

export function jitMemoryFaultReason(
  op: IrOp,
  operands: readonly JitOperandBinding[]
): ExitReasonValue | undefined {
  switch (op.op) {
    case "get32":
      return storageMayAccessMemory(op.source, operands) ? ExitReason.MEMORY_READ_FAULT : undefined;
    case "set32":
      return storageMayAccessMemory(op.target, operands) ? ExitReason.MEMORY_WRITE_FAULT : undefined;
    case "set32.if":
      if (storageMayAccessMemory(op.target, operands)) {
        throw new Error("JIT conditional memory writes are not supported by exit analysis");
      }

      return undefined;
    default:
      return undefined;
  }
}

export function jitPostInstructionExitReasons(
  op: IrOp,
  instruction: JitIrBlockInstruction
): readonly ExitReasonValue[] {
  switch (op.op) {
    case "next":
      return instruction.nextMode === "exit" ? [ExitReason.FALLTHROUGH] : [];
    case "jump":
      return [ExitReason.JUMP];
    case "conditionalJump":
      return [ExitReason.BRANCH_TAKEN, ExitReason.BRANCH_NOT_TAKEN];
    case "hostTrap":
      return [ExitReason.HOST_TRAP];
    default:
      return [];
  }
}

export function jitExitConditionValues(
  op: IrOp,
  instruction: JitIrBlockInstruction
): readonly ValueRef[] {
  if (jitPostInstructionExitReasons(op, instruction).length === 0) {
    return [];
  }

  switch (op.op) {
    case "conditionalJump":
      return [op.condition];
    default:
      return [];
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
