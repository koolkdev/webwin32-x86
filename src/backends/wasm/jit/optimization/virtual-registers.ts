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
  materializeVirtualRegsIntoPreviousInstruction
} from "./virtual-boundaries.js";
import { recordJitVirtualLocalValue } from "./virtual-local-values.js";
import {
  createJitVirtualRewrite,
  type JitVirtualRewrite
} from "./virtual-rewrite.js";
import {
  rewriteVirtualRegisterAddress32,
  rewriteVirtualRegisterGet32,
  rewriteVirtualRegisterSet32,
  rewriteVirtualRegisterSet32If,
  unchangedJitVirtualRegisterRewriteResult,
  type JitVirtualRegisterRewriteResult
} from "./virtual-register-op-rewrites.js";
import {
  firstVirtualRegisterFoldableOpIndex,
  recordCopiedVirtualRegisterOp
} from "./virtual-register-prefix.js";
import type { JitVirtualValue } from "./virtual-values.js";

export type JitVirtualRegisterFolding = Readonly<{
  removedSetCount: number;
  materializedSetCount: number;
}>;

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
): JitVirtualRegisterRewriteResult {
  switch (op.op) {
    case "get32":
      return rewriteVirtualRegisterGet32(op, instruction, rewrite, virtualRegs, virtualRegReadCounts);
    case "const32":
      recordJitVirtualLocalValue(op, instruction, rewrite.localValues, virtualRegs);
      rewrite.ops.push(op);
      return unchangedJitVirtualRegisterRewriteResult;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      recordJitVirtualLocalValue(op, instruction, rewrite.localValues, virtualRegs);
      rewrite.ops.push(op);
      return unchangedJitVirtualRegisterRewriteResult;
    case "address32":
      return rewriteVirtualRegisterAddress32(op, instruction, rewrite, virtualRegs, virtualRegReadCounts);
    case "set32":
      return rewriteVirtualRegisterSet32(op, instruction, rewrite, virtualRegs, virtualRegReadCounts);
    case "set32.if":
      return rewriteVirtualRegisterSet32If(op, instruction, rewrite, virtualRegs, virtualRegReadCounts);
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
      return unchangedJitVirtualRegisterRewriteResult;
  }
}

function nextInstructionHasPreInstructionExit(
  analysis: JitOptimizationAnalysis,
  instructionIndex: number,
  nextInstruction: JitIrBlockInstruction | undefined
): boolean {
  return nextInstruction !== undefined && jitInstructionHasPreInstructionExit(analysis.boundaries, instructionIndex + 1);
}
