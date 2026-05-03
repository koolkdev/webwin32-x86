import type { JitIrBlock, JitOptimizedIrBlock } from "#backends/wasm/jit/types.js";
import { runMergedJitIrOptimizationPipeline } from "./combined.js";
import type { JitDeadLocalValuePruning } from "./dead-local-values.js";
import type { JitFlagMaterialization } from "./flags.js";
import type { JitRegisterFolding } from "./register-folding.js";

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
  return runMergedJitIrOptimizationPipeline(block);
}
