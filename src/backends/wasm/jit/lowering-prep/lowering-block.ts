import type { JitBlockOptimization } from "#backends/wasm/jit/lowering-prep/types.js";
import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { analyzeJitBlockState } from "./exit-state-analysis.js";
import { insertJitFlagBoundaries } from "./flag-boundaries.js";

export function prepareJitLowering(optimizedBlock: JitIrBlock): JitBlockOptimization {
  const state = analyzeJitBlockState(optimizedBlock);

  return {
    ...state,
    block: optimizedBlock
  };
}

export function buildJitLoweringBlock(optimization: JitBlockOptimization): JitIrBlock {
  return insertJitFlagBoundaries(optimization.block, optimization);
}
