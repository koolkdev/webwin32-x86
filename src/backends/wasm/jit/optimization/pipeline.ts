import type { JitIrBlock, JitOptimizedIrBlock } from "#backends/wasm/jit/types.js";
import { runSharedJitIrOptimizationPipeline } from "#backends/wasm/jit/optimization/planner/planner.js";
import type { JitDeadLocalValuePruning } from "#backends/wasm/jit/optimization/passes/dead-local-values.js";
import type { JitFlagMaterialization } from "#backends/wasm/jit/optimization/flags/materialization.js";
import type { JitRegisterFolding } from "#backends/wasm/jit/optimization/passes/register-folding.js";

export const jitIrOptimizationPassOrder = [
  "tracked-optimization"
] as const;

export type JitIrOptimizationPassName = typeof jitIrOptimizationPassOrder[number];

export type JitIrOptimizationPipelineResult = Readonly<{
  block: JitOptimizedIrBlock;
  passes: Readonly<{
    flagMaterialization: JitFlagMaterialization;
    deadLocalValues: JitDeadLocalValuePruning;
    registerFolding: JitRegisterFolding;
  }>;
}>;

export function runJitIrOptimizationPipeline(block: JitIrBlock): JitIrOptimizationPipelineResult {
  return runSharedJitIrOptimizationPipeline(block);
}
