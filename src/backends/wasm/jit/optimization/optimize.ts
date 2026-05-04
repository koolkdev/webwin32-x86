import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { runJitIrOptimizationPipeline } from "./pipeline.js";
import { analyzeJitLoweringState } from "#backends/wasm/jit/lowering-plan/exit-state-analysis.js";
import type { JitLoweringPlan } from "#backends/wasm/jit/lowering-plan/types.js";

export type {
  JitLoweringPlan,
  JitExitPoint,
  JitExitSnapshotKind,
  JitExitState,
  JitFlagMaterializationRequirement,
  JitFlagSnapshot,
  JitInstructionState,
  JitStateSnapshot
} from "#backends/wasm/jit/lowering-plan/types.js";

export function optimizeJitIrBlockOnly(block: JitIrBlock): JitIrBlock {
  return runJitIrOptimizationPipeline(block).block;
}

export function optimizeJitIrBlock(block: JitIrBlock): JitLoweringPlan {
  const optimizedBlock = optimizeJitIrBlockOnly(block);
  const optimized = analyzeJitLoweringState(optimizedBlock);

  return {
    ...optimized,
    block: optimizedBlock
  };
}
