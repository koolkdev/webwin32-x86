import type { JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import type { JitOptimizationAnalysis } from "./analysis.js";
import { jitFirstOpIndexAfterPreInstructionExits } from "./boundaries.js";
import { recordJitVirtualLocalValue } from "./virtual-local-values.js";
import type { JitVirtualRewrite } from "./virtual-rewrite.js";

export function firstVirtualRegisterFoldableOpIndex(
  instructionIndex: number,
  analysis: JitOptimizationAnalysis
): number {
  return jitFirstOpIndexAfterPreInstructionExits(analysis.boundaries, instructionIndex);
}

export function recordCopiedVirtualRegisterOp(
  op: JitIrOp,
  instruction: JitIrBlockInstruction,
  rewrite: JitVirtualRewrite
): void {
  recordJitVirtualLocalValue(op, instruction, rewrite.localValues);
}
