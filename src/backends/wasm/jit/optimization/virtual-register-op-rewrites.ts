import type { Reg32 } from "#x86/isa/types.js";
import type { IrOp } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import {
  materializeVirtualRegsForRead,
  materializeVirtualRegsReadingReg
} from "./virtual-boundaries.js";
import { recordJitVirtualLocalValue } from "./virtual-local-values.js";
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
  jitVirtualValueForEffectiveAddress,
  jitVirtualValueForStorage,
  jitVirtualValueForValue,
  type JitVirtualValue
} from "./virtual-values.js";

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
  virtualRegs: Map<Reg32, JitVirtualValue>,
  virtualRegReadCounts: Map<Reg32, number>
): JitVirtualRegisterRewriteResult {
  let materializedSetCount = materializeRepeatedEffectiveAddressReads(
    op,
    instruction,
    rewrite,
    virtualRegs,
    virtualRegReadCounts
  );
  const value = jitVirtualValueForEffectiveAddress(op.operand, instruction.operands, virtualRegs);

  if (value === undefined) {
    materializedSetCount += materializeVirtualRegsForRead(
      rewrite,
      virtualRegs,
      jitVirtualRegsReadByEffectiveAddress(op.operand, instruction.operands, virtualRegs)
    );
    syncVirtualRegReadCounts(virtualRegReadCounts, virtualRegs);
    recordJitVirtualLocalValue(op, instruction, rewrite.localValues, virtualRegs);
    rewrite.ops.push(op);
    return { removedSet: false, materializedSetCount };
  }

  for (const reg of jitVirtualRegsReadByEffectiveAddress(op.operand, instruction.operands, virtualRegs)) {
    virtualRegReadCounts.set(reg, (virtualRegReadCounts.get(reg) ?? 0) + 1);
  }

  recordJitVirtualLocalValue(op, instruction, rewrite.localValues, virtualRegs);
  return { removedSet: false, materializedSetCount };
}

export function rewriteVirtualRegisterGet32(
  op: Extract<IrOp, { op: "get32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>,
  virtualRegReadCounts: Map<Reg32, number>
): JitVirtualRegisterRewriteResult {
  const sourceReg = jitStorageReg(op.source, instruction.operands);
  const value = jitVirtualValueForStorage(op.source, instruction.operands, virtualRegs);

  if (value === undefined || !jitStorageHasVirtualRegister(op.source, instruction.operands, virtualRegs)) {
    rewrite.ops.push(op);
  } else {
    if (
      sourceReg !== undefined &&
      shouldMaterializeRepeatedVirtualRegisterRead(sourceReg, value, virtualRegReadCounts)
    ) {
      const materializedSetCount = materializeVirtualRegsForRead(rewrite, virtualRegs, [sourceReg]);

      virtualRegReadCounts.delete(sourceReg);
      rewrite.ops.push(op);
      recordJitVirtualLocalValue(op, instruction, rewrite.localValues, virtualRegs);
      return { removedSet: false, materializedSetCount };
    }

    if (sourceReg !== undefined) {
      virtualRegReadCounts.set(sourceReg, (virtualRegReadCounts.get(sourceReg) ?? 0) + 1);
    }

    assignJitValue(rewrite, op.dst, value);
  }

  recordJitVirtualLocalValue(op, instruction, rewrite.localValues, virtualRegs);

  return unchangedJitVirtualRegisterRewriteResult;
}

export function rewriteVirtualRegisterSet32If(
  op: Extract<IrOp, { op: "set32.if" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>,
  virtualRegReadCounts: Map<Reg32, number>
): JitVirtualRegisterRewriteResult {
  const target = jitStorageReg(op.target, instruction.operands);
  let materializedSetCount = target === undefined
    ? 0
    : materializeVirtualRegsForRead(rewrite, virtualRegs, [target]);

  if (target !== undefined) {
    materializedSetCount += materializeVirtualRegsReadingReg(rewrite, virtualRegs, target);
    virtualRegs.delete(target);
    virtualRegReadCounts.delete(target);
  }

  syncVirtualRegReadCounts(virtualRegReadCounts, virtualRegs);
  rewrite.ops.push(op);
  return { removedSet: false, materializedSetCount };
}

export function rewriteVirtualRegisterSet32(
  op: Extract<IrOp, { op: "set32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>,
  virtualRegReadCounts: Map<Reg32, number>
): JitVirtualRegisterRewriteResult {
  const target = jitStorageReg(op.target, instruction.operands);
  const value = jitVirtualValueForValue(op.value, rewrite.localValues);
  const materializedSetCount = target === undefined
    ? 0
    : materializeVirtualRegsReadingReg(rewrite, virtualRegs, target);

  syncVirtualRegReadCounts(virtualRegReadCounts, virtualRegs);

  if (target !== undefined && value !== undefined) {
    if (!shouldRetainVirtualRegisterValue(value)) {
      virtualRegs.delete(target);
      virtualRegReadCounts.delete(target);
      rewrite.ops.push(op);
      return { removedSet: false, materializedSetCount };
    }

    virtualRegs.set(target, value);
    virtualRegReadCounts.set(target, 0);
    return { removedSet: true, materializedSetCount };
  }

  if (target !== undefined) {
    virtualRegs.delete(target);
    virtualRegReadCounts.delete(target);
  }

  rewrite.ops.push(op);
  return { removedSet: false, materializedSetCount };
}
