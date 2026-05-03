import type { Reg32 } from "#x86/isa/types.js";
import type { IrOp } from "#x86/ir/model/types.js";
import type { JitIrBlock, JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import {
  analyzeJitOptimization,
  type JitOptimizationAnalysis
} from "./analysis.js";
import {
  jitInstructionHasPreInstructionExit,
  jitOpHasPostInstructionExit
} from "./boundaries.js";
import {
  materializeAllVirtualRegs,
  materializeVirtualRegsIntoPreviousInstruction,
  materializeVirtualRegsForRead,
  materializeVirtualRegsReadingReg
} from "./virtual-boundaries.js";
import { recordJitVirtualLocalValue } from "./virtual-local-values.js";
import {
  createJitVirtualRewrite,
  emitJitVirtualValueToVar,
  type JitVirtualRewrite
} from "./virtual-rewrite.js";
import {
  materializeRepeatedEffectiveAddressReads,
  shouldMaterializeRepeatedVirtualRegisterRead,
  shouldRetainVirtualRegisterValue,
  syncVirtualRegReadCounts
} from "./virtual-register-budget.js";
import {
  firstVirtualRegisterFoldableOpIndex,
  recordCopiedVirtualRegisterOp
} from "./virtual-register-prefix.js";
import {
  jitStorageHasVirtualRegister,
  jitStorageReg,
  jitVirtualRegsReadByEffectiveAddress,
  jitVirtualValueForEffectiveAddress,
  jitVirtualValueForStorage,
  jitVirtualValueForValue,
  type JitVirtualValue
} from "./virtual-values.js";

export type JitVirtualRegisterFolding = Readonly<{
  removedSetCount: number;
  materializedSetCount: number;
}>;

type RewriteResult = Readonly<{
  removedSet: boolean;
  materializedSetCount: number;
}>;

const unchangedOpResult: RewriteResult = { removedSet: false, materializedSetCount: 0 };

export function foldJitVirtualRegisters(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
): Readonly<{ block: JitIrBlock; folding: JitVirtualRegisterFolding }> {
  const virtualRegs = new Map<Reg32, JitVirtualValue>();
  const virtualRegReadCounts = new Map<Reg32, number>();
  const instructions: JitIrBlockInstruction[] = [];
  let removedSetCount = 0;
  let materializedSetCount = 0;

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while folding virtual registers: ${instructionIndex}`);
    }

    if (jitInstructionHasPreInstructionExit(analysis.boundaries, instructionIndex)) {
      materializedSetCount += materializeVirtualRegsIntoPreviousInstruction(instructions, virtualRegs);
      virtualRegs.clear();
      virtualRegReadCounts.clear();
    }

    const rewrite = createJitVirtualRewrite(instruction);
    const nextInstruction = block.instructions[instructionIndex + 1];
    const firstFoldableOpIndex = firstVirtualRegisterFoldableOpIndex(instructionIndex, analysis);

    for (let opIndex = 0; opIndex < instruction.ir.length; opIndex += 1) {
      const op = instruction.ir[opIndex];

      if (op === undefined) {
        throw new Error(`missing JIT IR op while folding virtual registers: ${instructionIndex}:${opIndex}`);
      }

      if (opIndex < firstFoldableOpIndex) {
        recordCopiedVirtualRegisterOp(op, instruction, rewrite);
        rewrite.ops.push(op);
        continue;
      }

      const result = rewriteOp(
        op,
        instruction,
        instructionIndex,
        opIndex,
        nextInstruction,
        analysis,
        rewrite,
        virtualRegs,
        virtualRegReadCounts
      );

      if (result.removedSet) {
        removedSetCount += 1;
      }

      materializedSetCount += result.materializedSetCount;
    }

    instructions.push({
      ...instruction,
      ir: rewrite.ops
    });
  }

  if (virtualRegs.size !== 0) {
    throw new Error("JIT virtual registers were not materialized before block end");
  }

  return {
    block: { instructions },
    folding: { removedSetCount, materializedSetCount }
  };
}

function rewriteOp(
  op: IrOp,
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  opIndex: number,
  nextInstruction: JitIrBlockInstruction | undefined,
  analysis: JitOptimizationAnalysis,
  rewrite: JitVirtualRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>,
  virtualRegReadCounts: Map<Reg32, number>
): RewriteResult {
  switch (op.op) {
    case "get32":
      return rewriteGet32(op, instruction, rewrite, virtualRegs, virtualRegReadCounts);
    case "const32":
      recordJitVirtualLocalValue(op, instruction, rewrite.localValues, virtualRegs);
      rewrite.ops.push(op);
      return unchangedOpResult;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      recordJitVirtualLocalValue(op, instruction, rewrite.localValues, virtualRegs);
      rewrite.ops.push(op);
      return unchangedOpResult;
    case "address32":
      return rewriteAddress32(op, instruction, rewrite, virtualRegs, virtualRegReadCounts);
    case "set32":
      return rewriteSet32(op, instruction, rewrite, virtualRegs, virtualRegReadCounts);
    case "set32.if":
      return rewriteSet32If(op, instruction, rewrite, virtualRegs, virtualRegReadCounts);
    case "next": {
      const shouldMaterialize = jitOpHasPostInstructionExit(analysis.boundaries, instructionIndex, opIndex) ||
        nextInstructionHasPreInstructionExit(analysis, instructionIndex, nextInstruction);
      const materializedSetCount = shouldMaterialize
        ? materializeAllVirtualRegs(rewrite, virtualRegs)
        : 0;

      if (materializedSetCount !== 0) {
        virtualRegReadCounts.clear();
      }

      rewrite.ops.push(op);
      return { removedSet: false, materializedSetCount };
    }
    case "jump":
    case "conditionalJump":
    case "hostTrap": {
      const materializedSetCount = !jitOpHasPostInstructionExit(analysis.boundaries, instructionIndex, opIndex)
        ? 0
        : materializeAllVirtualRegs(rewrite, virtualRegs);

      if (materializedSetCount !== 0) {
        virtualRegReadCounts.clear();
      }

      rewrite.ops.push(op);
      return { removedSet: false, materializedSetCount };
    }
    default:
      rewrite.ops.push(op);
      return unchangedOpResult;
  }
}

function rewriteAddress32(
  op: Extract<IrOp, { op: "address32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitVirtualRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>,
  virtualRegReadCounts: Map<Reg32, number>
): RewriteResult {
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

function rewriteGet32(
  op: Extract<IrOp, { op: "get32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitVirtualRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>,
  virtualRegReadCounts: Map<Reg32, number>
): RewriteResult {
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

    emitJitVirtualValueToVar(rewrite, op.dst, value);
  }

  recordJitVirtualLocalValue(op, instruction, rewrite.localValues, virtualRegs);

  return unchangedOpResult;
}

function rewriteSet32If(
  op: Extract<IrOp, { op: "set32.if" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitVirtualRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>,
  virtualRegReadCounts: Map<Reg32, number>
): RewriteResult {
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

function rewriteSet32(
  op: Extract<IrOp, { op: "set32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitVirtualRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>,
  virtualRegReadCounts: Map<Reg32, number>
): RewriteResult {
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

function nextInstructionHasPreInstructionExit(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number,
  nextInstruction: JitIrBlockInstruction | undefined
): boolean {
  return nextInstruction !== undefined && jitInstructionHasPreInstructionExit(analysis.boundaries, instructionIndex + 1);
}
