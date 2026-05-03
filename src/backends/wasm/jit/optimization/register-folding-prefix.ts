import type { JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import { jitFirstOpIndexAfterPreInstructionExits } from "./effects.js";
import type { JitInstructionRewrite } from "./rewrite.js";
import type { JitOptimizationState } from "./state.js";

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
