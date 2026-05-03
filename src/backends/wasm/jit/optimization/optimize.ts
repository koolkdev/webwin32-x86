import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { runJitIrOptimizationPipeline } from "./pipeline.js";
import { analyzeJitBlockState } from "./state-analysis.js";
import type { JitBlockOptimization } from "./types.js";

export type {
  JitBlockOptimization,
  JitExitPoint,
  JitExitSnapshotKind,
  JitExitState,
  JitFlagMaterializationRequirement,
  JitFlagSnapshot,
  JitInstructionState,
  JitStateSnapshot
} from "./types.js";

export function optimizeJitIrBlock(block: JitIrBlock): JitBlockOptimization {
  const pipeline = runJitIrOptimizationPipeline(block);
  const optimized = analyzeJitBlockState(pipeline.block);

  return {
    ...optimized,
    block: pipeline.block
  };
}
