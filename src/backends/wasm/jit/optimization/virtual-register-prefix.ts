import type { JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import type { JitOptimizationAnalysis } from "./analysis.js";
import { jitFirstOpIndexAfterPreInstructionExits } from "./events.js";
import { recordJitVirtualLocalValue } from "./virtual-local-values.js";
import type { JitInstructionRewrite } from "./rewrite.js";

export function firstVirtualRegisterFoldableOpIndex(
  instructionIndex: number,
  analysis: JitOptimizationAnalysis
): number {
  return jitFirstOpIndexAfterPreInstructionExits(analysis.events, instructionIndex);
}

export function recordCopiedVirtualRegisterOp(
  op: JitIrOp,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite
): void {
  recordJitVirtualLocalValue(op, instruction, rewrite.localValues);
}
