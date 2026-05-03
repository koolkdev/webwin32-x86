import type { JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import type { JitOptimizationAnalysis } from "./analysis.js";
import { jitFirstOpIndexAfterPreInstructionExits } from "./effects.js";
import type { JitInstructionRewrite } from "./rewrite.js";

export function firstVirtualRegisterFoldableOpIndex(
  instructionIndex: number,
  analysis: JitOptimizationAnalysis
): number {
  return jitFirstOpIndexAfterPreInstructionExits(analysis.context.effects, instructionIndex);
}

export function recordCopiedVirtualRegisterOp(
  op: JitIrOp,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite
): void {
  rewrite.values.recordOp(op, instruction);
}
