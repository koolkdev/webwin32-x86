import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { analyzeJitOptimization } from "#backends/wasm/jit/optimization/tracked/analysis.js";
import { runJitIrOptimizationPipeline } from "./pipeline.js";
import { analyzeJitBlockState } from "#backends/wasm/jit/optimization/tracked/state-analysis.js";
import type { JitBlockOptimization } from "#backends/wasm/jit/optimization/tracked/types.js";

export type {
  JitBlockOptimization,
  JitExitPoint,
  JitExitSnapshotKind,
  JitExitState,
  JitFlagMaterializationRequirement,
  JitFlagSnapshot,
  JitInstructionState,
  JitStateSnapshot
} from "#backends/wasm/jit/optimization/tracked/types.js";

export function optimizeJitIrBlock(block: JitIrBlock): JitBlockOptimization {
  const pipeline = runJitIrOptimizationPipeline(block);
  const optimizedAnalysis = analyzeJitOptimization(pipeline.block);
  const optimized = analyzeJitBlockState(pipeline.block, optimizedAnalysis);

  return {
    ...optimized,
    block: pipeline.block
  };
}
