import type { IrOp } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import type { JitOptimizationState } from "./state.js";
import {
  materializeRegisterValuesForRead,
  materializeRegisterValuesReadingReg
} from "./register-materialization.js";
import {
  assignJitValue,
  type JitInstructionRewrite
} from "./rewrite.js";
import {
  materializeRepeatedEffectiveAddressReads,
  shouldMaterializeRepeatedRegisterRead,
  shouldRetainRegisterValue,
  syncRegisterReadCounts
} from "./register-policy.js";
import {
  jitStorageReg
} from "./values.js";

export type JitRegisterRewriteResult = Readonly<{
  removedSet: boolean;
  materializedSetCount: number;
}>;

export const unchangedJitRegisterRewriteResult: JitRegisterRewriteResult = {
  removedSet: false,
  materializedSetCount: 0
};

export function rewriteRegisterAddress32(
  op: Extract<IrOp, { op: "address32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState
): JitRegisterRewriteResult {
  const { registers } = state;
  let materializedSetCount = materializeRepeatedEffectiveAddressReads(
    op,
    instruction,
    rewrite,
    registers
  );
  const value = registers.valueForEffectiveAddress(op.operand, instruction.operands);

  if (value === undefined) {
    materializedSetCount += materializeRegisterValuesForRead(
      rewrite,
      registers,
      registers.regsReadByEffectiveAddress(op.operand, instruction.operands)
    );
    syncRegisterReadCounts(registers);
    state.recordOpValue(op, instruction);
    rewrite.ops.push(op);
    return { removedSet: false, materializedSetCount };
  }

  for (const reg of registers.regsReadByEffectiveAddress(op.operand, instruction.operands)) {
    registers.recordRead(reg);
  }

  state.recordOpValue(op, instruction);
  return { removedSet: false, materializedSetCount };
}

export function rewriteRegisterGet32(
  op: Extract<IrOp, { op: "get32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState
): JitRegisterRewriteResult {
  const { registers } = state;
  const sourceReg = jitStorageReg(op.source, instruction.operands);
  const value = registers.valueForStorage(op.source, instruction.operands);

  if (value === undefined || !registers.hasStorageValue(op.source, instruction.operands)) {
    rewrite.ops.push(op);
  } else {
    if (
      sourceReg !== undefined &&
      shouldMaterializeRepeatedRegisterRead(sourceReg, value, registers)
    ) {
      const materializedSetCount = materializeRegisterValuesForRead(rewrite, registers, [sourceReg]);

      rewrite.ops.push(op);
      state.recordOpValue(op, instruction);
      return { removedSet: false, materializedSetCount };
    }

    if (sourceReg !== undefined) {
      registers.recordRead(sourceReg);
    }

    assignJitValue(rewrite, op.dst, value);
  }

  state.recordOpValue(op, instruction);

  return unchangedJitRegisterRewriteResult;
}

export function rewriteRegisterSet32If(
  op: Extract<IrOp, { op: "set32.if" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState
): JitRegisterRewriteResult {
  const { registers } = state;
  const target = jitStorageReg(op.target, instruction.operands);
  let materializedSetCount = target === undefined
    ? 0
    : materializeRegisterValuesForRead(rewrite, registers, [target]);

  if (target !== undefined) {
    materializedSetCount += materializeRegisterValuesReadingReg(rewrite, registers, target);
    registers.delete(target);
  }

  syncRegisterReadCounts(registers);
  rewrite.ops.push(op);
  return { removedSet: false, materializedSetCount };
}

export function rewriteRegisterSet32(
  op: Extract<IrOp, { op: "set32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState
): JitRegisterRewriteResult {
  const { registers } = state;
  const target = jitStorageReg(op.target, instruction.operands);
  const value = state.values.valueFor(op.value);
  const materializedSetCount = target === undefined
    ? 0
    : materializeRegisterValuesReadingReg(rewrite, registers, target);

  syncRegisterReadCounts(registers);

  if (target !== undefined && value !== undefined) {
    if (!shouldRetainRegisterValue(value)) {
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
