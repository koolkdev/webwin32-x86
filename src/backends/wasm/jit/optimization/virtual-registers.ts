import type { Reg32 } from "#x86/isa/types.js";
import type {
  JitIrBlock,
  JitIrBlockInstruction,
  JitIrOp,
  JitOptimizedIrBlock,
  JitOptimizedIrBlockInstruction
} from "#backends/wasm/jit/types.js";
import { toJitOptimizedIrPreludeOp } from "#backends/wasm/jit/prelude.js";
import {
  analyzeJitOptimization,
  type JitOptimizationAnalysis
} from "./analysis.js";
import {
  materializeVirtualRegsForPostInstructionExit,
  materializeVirtualRegsForPreInstructionExits
} from "./virtual-register-materialization.js";
import {
  createJitInstructionRewrite,
  createJitPreludeRewrite,
  rewriteJitIrInstructionInto,
  type JitInstructionRewrite
} from "./rewrite.js";
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
import type { JitValue } from "./values.js";

export type JitVirtualRegisterFolding = Readonly<{
  removedSetCount: number;
  materializedSetCount: number;
}>;

export function foldJitVirtualRegisters(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
): Readonly<{ block: JitOptimizedIrBlock; folding: JitVirtualRegisterFolding }> {
  const virtualRegs = new Map<Reg32, JitValue>();
  const virtualRegReadCounts = new Map<Reg32, number>();
  const instructions: JitOptimizedIrBlockInstruction[] = [];
  let removedSetCount = 0;
  let materializedSetCount = 0;

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while folding virtual registers: ${instructionIndex}`);
    }

    const prelude = createJitPreludeRewrite();

    materializedSetCount += materializeVirtualRegsForPreInstructionExits(
      prelude,
      analysis.context.effects,
      instructionIndex,
      virtualRegs,
      virtualRegReadCounts
    );

    const rewrite = createJitInstructionRewrite(instruction);
    const firstFoldableOpIndex = firstVirtualRegisterFoldableOpIndex(instructionIndex, analysis);

    rewriteJitIrInstructionInto(
      instruction,
      instructionIndex,
      "folding virtual registers",
      rewrite,
      ({ op, opIndex }) => {
        if (opIndex < firstFoldableOpIndex) {
          recordCopiedVirtualRegisterOp(op, instruction, rewrite);
          rewrite.ops.push(op);
          return;
        }

        const result = rewriteOp(
          op,
          instruction,
          instructionIndex,
          opIndex,
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
    );

    instructions.push({
      ...instruction,
      prelude: prelude.ops.map(toJitOptimizedIrPreludeOp),
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
  op: JitIrOp,
  instruction: JitIrBlockInstruction,
  instructionIndex: number,
  opIndex: number,
  analysis: JitOptimizationAnalysis,
  rewrite: JitInstructionRewrite,
  virtualRegs: Map<Reg32, JitValue>,
  virtualRegReadCounts: Map<Reg32, number>
): JitVirtualRegisterRewriteResult {
  switch (op.op) {
    case "get32":
      return rewriteVirtualRegisterGet32(op, instruction, rewrite, virtualRegs, virtualRegReadCounts);
    case "const32":
      rewrite.values.recordOp(op, instruction, virtualRegs);
      rewrite.ops.push(op);
      return unchangedJitVirtualRegisterRewriteResult;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      rewrite.values.recordOp(op, instruction, virtualRegs);
      rewrite.ops.push(op);
      return unchangedJitVirtualRegisterRewriteResult;
    case "address32":
      return rewriteVirtualRegisterAddress32(op, instruction, rewrite, virtualRegs, virtualRegReadCounts);
    case "set32":
      return rewriteVirtualRegisterSet32(op, instruction, rewrite, virtualRegs, virtualRegReadCounts);
    case "set32.if":
      return rewriteVirtualRegisterSet32If(op, instruction, rewrite, virtualRegs, virtualRegReadCounts);
    case "next":
    case "jump":
    case "conditionalJump":
    case "hostTrap": {
      const materializedSetCount = materializeVirtualRegsForPostInstructionExit(
        rewrite,
        analysis.context.effects,
        instructionIndex,
        opIndex,
        virtualRegs,
        virtualRegReadCounts
      );

      rewrite.ops.push(op);
      return { removedSet: false, materializedSetCount };
    }
    default:
      rewrite.ops.push(op);
      return unchangedJitVirtualRegisterRewriteResult;
  }
}
