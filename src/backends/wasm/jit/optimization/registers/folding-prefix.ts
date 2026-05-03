import type { JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import { jitFirstOpIndexAfterPreInstructionExits } from "#backends/wasm/jit/optimization/effects/effects.js";
import type { JitInstructionRewrite } from "#backends/wasm/jit/optimization/ir/rewrite.js";
import type { JitOptimizationState } from "#backends/wasm/jit/optimization/tracked/optimization-state.js";

export function firstRegisterFoldableOpIndex(
  instructionIndex: number,
  state: JitOptimizationState
): number {
  return jitFirstOpIndexAfterPreInstructionExits(state.context.effects, instructionIndex);
}

export function recordCopiedRegisterOp(
  op: JitIrOp,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite
): void {
  rewrite.values.recordOp(op, instruction);
}
