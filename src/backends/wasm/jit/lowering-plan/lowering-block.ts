import type { JitLoweringPlan } from "#backends/wasm/jit/lowering-plan/types.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { analyzeJitLoweringState } from "./exit-state-analysis.js";
import { insertJitFlagBoundaries } from "./flag-boundaries.js";

export function planJitLowering(optimizedBlock: JitIrBlock): JitLoweringPlan {
  const state = analyzeJitLoweringState(optimizedBlock);

  return {
    ...state,
    block: optimizedBlock
  };
}

export function buildJitLoweringIr(loweringPlan: JitLoweringPlan): JitIrBlock {
  return insertJitFlagBoundaries(loweringPlan.block, loweringPlan);
}
