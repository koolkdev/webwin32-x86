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
} from "#backends/wasm/jit/optimization/tracked/analysis.js";
import { JitOptimizationState } from "#backends/wasm/jit/optimization/tracked/optimization-state.js";
import {
  materializeRegisterValuesForPostInstructionExit,
  materializeRegisterValuesForPreInstructionExits
} from "#backends/wasm/jit/optimization/registers/materialization.js";
import {
  createJitPreludeRewrite,
  rewriteJitIrInstructionInto,
  type JitInstructionRewrite
} from "#backends/wasm/jit/optimization/ir/rewrite.js";
import {
  rewriteRegisterAddress32,
  rewriteRegisterGet32,
  rewriteRegisterSet32,
  rewriteRegisterSet32If,
  unchangedJitRegisterRewriteResult,
  type JitRegisterRewriteResult
} from "#backends/wasm/jit/optimization/registers/rewrite.js";
import {
  firstRegisterFoldableOpIndex,
  recordCopiedRegisterOp
} from "#backends/wasm/jit/optimization/registers/folding-prefix.js";

export type JitRegisterFolding = Readonly<{
  removedSetCount: number;
  materializedSetCount: number;
}>;

export function foldJitRegisters(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
): Readonly<{ block: JitOptimizedIrBlock; folding: JitRegisterFolding }> {
  const state = new JitOptimizationState(analysis.context);
  const instructions: JitOptimizedIrBlockInstruction[] = [];
  let removedSetCount = 0;
  let materializedSetCount = 0;

  for (let instructionIndex = 0; instructionIndex < block.instructions.length; instructionIndex += 1) {
    const instruction = block.instructions[instructionIndex];

    if (instruction === undefined) {
      throw new Error(`missing JIT instruction while folding register values: ${instructionIndex}`);
    }

    const prelude = createJitPreludeRewrite();

    materializedSetCount += materializeRegisterValuesForPreInstructionExits(
      prelude,
      instructionIndex,
      state
    );

    const rewrite = state.beginInstructionRewrite(instruction);
    const firstFoldableOpIndex = firstRegisterFoldableOpIndex(instructionIndex, state);

    rewriteJitIrInstructionInto(
      instruction,
      instructionIndex,
      "folding register values",
      rewrite,
      ({ op, opIndex }) => {
        if (opIndex < firstFoldableOpIndex) {
          recordCopiedRegisterOp(op, instruction, rewrite);
          rewrite.ops.push(op);
          return;
        }

        const result = rewriteOp(
          op,
          instruction,
          instructionIndex,
          opIndex,
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

  if (state.tracked.registers.size !== 0) {
    throw new Error("JIT register values were not materialized before block end");
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
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState
): JitRegisterRewriteResult {
  switch (op.op) {
    case "get32":
      return rewriteRegisterGet32(op, instruction, rewrite, state);
    case "const32":
      state.recordOpValue(op, instruction);
      rewrite.ops.push(op);
      return unchangedJitRegisterRewriteResult;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      state.recordOpValue(op, instruction);
      rewrite.ops.push(op);
      return unchangedJitRegisterRewriteResult;
    case "address32":
      return rewriteRegisterAddress32(op, instruction, rewrite, state);
    case "set32":
      return rewriteRegisterSet32(op, instruction, rewrite, state);
    case "set32.if":
      return rewriteRegisterSet32If(op, instruction, rewrite, state);
    case "next":
    case "jump":
    case "conditionalJump":
    case "hostTrap": {
      const materializedSetCount = materializeRegisterValuesForPostInstructionExit(
        rewrite,
        instructionIndex,
        opIndex,
        state
      );

      rewrite.ops.push(op);
      return { removedSet: false, materializedSetCount };
    }
    default:
      rewrite.ops.push(op);
      return unchangedJitRegisterRewriteResult;
  }
}
