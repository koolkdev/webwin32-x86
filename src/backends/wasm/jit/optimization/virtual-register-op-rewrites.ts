import type { IrOp } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import { JitRegisterValues } from "./register-values.js";
import {
  materializeVirtualRegsForRead,
  materializeVirtualRegsReadingReg
} from "./virtual-register-materialization.js";
import {
  assignJitValue,
  type JitInstructionRewrite
} from "./rewrite.js";
import {
  materializeRepeatedEffectiveAddressReads,
  shouldMaterializeRepeatedVirtualRegisterRead,
  shouldRetainVirtualRegisterValue,
  syncVirtualRegReadCounts
} from "./virtual-register-budget.js";
import {
  jitStorageHasVirtualRegister,
  jitStorageReg,
  jitVirtualRegsReadByEffectiveAddress,
  jitValueForEffectiveAddress,
  jitValueForStorage
} from "./values.js";

export type JitVirtualRegisterRewriteResult = Readonly<{
  removedSet: boolean;
  materializedSetCount: number;
}>;

export const unchangedJitVirtualRegisterRewriteResult: JitVirtualRegisterRewriteResult = {
  removedSet: false,
  materializedSetCount: 0
};

export function rewriteVirtualRegisterAddress32(
  op: Extract<IrOp, { op: "address32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues
): JitVirtualRegisterRewriteResult {
  let materializedSetCount = materializeRepeatedEffectiveAddressReads(
    op,
    instruction,
    rewrite,
    registers
  );
  const value = jitValueForEffectiveAddress(op.operand, instruction.operands, registers.values);

  if (value === undefined) {
    materializedSetCount += materializeVirtualRegsForRead(
      rewrite,
      registers,
      jitVirtualRegsReadByEffectiveAddress(op.operand, instruction.operands, registers.values)
    );
    syncVirtualRegReadCounts(registers);
    rewrite.values.recordOp(op, instruction, registers.values);
    rewrite.ops.push(op);
    return { removedSet: false, materializedSetCount };
  }

  for (const reg of jitVirtualRegsReadByEffectiveAddress(op.operand, instruction.operands, registers.values)) {
    registers.recordRead(reg);
  }

  rewrite.values.recordOp(op, instruction, registers.values);
  return { removedSet: false, materializedSetCount };
}

export function rewriteVirtualRegisterGet32(
  op: Extract<IrOp, { op: "get32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues
): JitVirtualRegisterRewriteResult {
  const sourceReg = jitStorageReg(op.source, instruction.operands);
  const value = jitValueForStorage(op.source, instruction.operands, registers.values);

  if (value === undefined || !jitStorageHasVirtualRegister(op.source, instruction.operands, registers.values)) {
    rewrite.ops.push(op);
  } else {
    if (
      sourceReg !== undefined &&
      shouldMaterializeRepeatedVirtualRegisterRead(sourceReg, value, registers)
    ) {
      const materializedSetCount = materializeVirtualRegsForRead(rewrite, registers, [sourceReg]);

      rewrite.ops.push(op);
      rewrite.values.recordOp(op, instruction, registers.values);
      return { removedSet: false, materializedSetCount };
    }

    if (sourceReg !== undefined) {
      registers.recordRead(sourceReg);
    }

    assignJitValue(rewrite, op.dst, value);
  }

  rewrite.values.recordOp(op, instruction, registers.values);

  return unchangedJitVirtualRegisterRewriteResult;
}

export function rewriteVirtualRegisterSet32If(
  op: Extract<IrOp, { op: "set32.if" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues
): JitVirtualRegisterRewriteResult {
  const target = jitStorageReg(op.target, instruction.operands);
  let materializedSetCount = target === undefined
    ? 0
    : materializeVirtualRegsForRead(rewrite, registers, [target]);

  if (target !== undefined) {
    materializedSetCount += materializeVirtualRegsReadingReg(rewrite, registers, target);
    registers.delete(target);
  }

  syncVirtualRegReadCounts(registers);
  rewrite.ops.push(op);
  return { removedSet: false, materializedSetCount };
}

export function rewriteVirtualRegisterSet32(
  op: Extract<IrOp, { op: "set32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues
): JitVirtualRegisterRewriteResult {
  const target = jitStorageReg(op.target, instruction.operands);
  const value = rewrite.values.valueFor(op.value);
  const materializedSetCount = target === undefined
    ? 0
    : materializeVirtualRegsReadingReg(rewrite, registers, target);

  syncVirtualRegReadCounts(registers);

  if (target !== undefined && value !== undefined) {
    if (!shouldRetainVirtualRegisterValue(value)) {
      registers.delete(target);
      rewrite.ops.push(op);
      return { removedSet: false, materializedSetCount };
    }

    registers.set(target, value);
    return { removedSet: true, materializedSetCount };
  }

  if (target !== undefined) {
    registers.delete(target);
  }

  rewrite.ops.push(op);
  return { removedSet: false, materializedSetCount };
}
