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
import { JitOptimizationState } from "./state.js";
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

export type JitVirtualRegisterFolding = Readonly<{
  removedSetCount: number;
  materializedSetCount: number;
}>;

export function foldJitVirtualRegisters(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
): Readonly<{ block: JitOptimizedIrBlock; folding: JitVirtualRegisterFolding }> {
  const state = new JitOptimizationState();
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
      state.registers
    );

    const rewrite = state.beginInstructionRewrite(instruction);
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
          state
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

  if (state.registers.size !== 0) {
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
  state: JitOptimizationState
): JitVirtualRegisterRewriteResult {
  switch (op.op) {
    case "get32":
      return rewriteVirtualRegisterGet32(op, instruction, rewrite, state);
    case "const32":
      state.recordOpValue(op, instruction);
      rewrite.ops.push(op);
      return unchangedJitVirtualRegisterRewriteResult;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      state.recordOpValue(op, instruction);
      rewrite.ops.push(op);
      return unchangedJitVirtualRegisterRewriteResult;
    case "address32":
      return rewriteVirtualRegisterAddress32(op, instruction, rewrite, state);
    case "set32":
      return rewriteVirtualRegisterSet32(op, instruction, rewrite, state);
    case "set32.if":
      return rewriteVirtualRegisterSet32If(op, instruction, rewrite, state);
    case "next":
    case "jump":
    case "conditionalJump":
    case "hostTrap": {
      const materializedSetCount = materializeVirtualRegsForPostInstructionExit(
        rewrite,
        analysis.context.effects,
        instructionIndex,
        opIndex,
        state.registers
      );

      rewrite.ops.push(op);
      return { removedSet: false, materializedSetCount };
    }
    default:
      rewrite.ops.push(op);
      return unchangedJitVirtualRegisterRewriteResult;
  }
}
