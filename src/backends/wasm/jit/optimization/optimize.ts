import type { JitIrBlock, JitOptimizedIrBlock } from "#backends/wasm/jit/types.js";
import { runJitIrPassOptimizationPipeline } from "./pipeline.js";
import { analyzeJitBlockState } from "#backends/wasm/jit/lowering-prep/exit-state-analysis.js";
import type { JitBlockOptimization } from "#backends/wasm/jit/lowering-prep/types.js";

export type {
  JitBlockOptimization,
  JitExitPoint,
  JitExitSnapshotKind,
  JitExitState,
  JitFlagMaterializationRequirement,
  JitFlagSnapshot,
  JitInstructionState,
  JitStateSnapshot
} from "#backends/wasm/jit/lowering-prep/types.js";

export function optimizeJitIrBlockOnly(block: JitIrBlock): JitOptimizedIrBlock {
  return runJitIrPassOptimizationPipeline(block).block;
}

export function optimizeJitIrBlock(block: JitIrBlock): JitBlockOptimization {
  const optimizedBlock = optimizeJitIrBlockOnly(block);
  const optimized = analyzeJitBlockState(optimizedBlock);

  return {
    ...optimized,
    block: optimizedBlock
  };
}
