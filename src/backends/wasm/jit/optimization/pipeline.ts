import type { JitIrBlock, JitOptimizedIrBlock } from "#backends/wasm/jit/types.js";
import type { JitOptimizationPass, JitOptimizationPassRun, JitPassContext } from "./pass.js";
import { runJitOptimizationPasses } from "./pass.js";
import { collectJitPassStats, type JitPassStatsByName } from "./stats.js";
import { localDcePass } from "./passes/local-dce.js";
import { flagConditionSpecializationPass } from "./passes/flag-condition-specialization.js";
import { flagDcePass } from "./passes/flag-dce.js";
import { registerValuePropagationPass } from "./passes/register-value-propagation.js";
import { verifyJitIrBlock } from "./verify/optimizer-invariants.js";

export const jitIrOptimizationPasses = [
  localDcePass,
  flagConditionSpecializationPass,
  flagDcePass,
  localDcePass,
  registerValuePropagationPass,
  localDcePass
] as const satisfies readonly JitOptimizationPass[];

export const jitIrOptimizationPassOrder = jitIrOptimizationPasses.map((pass) => pass.name);
export const jitIrPassOptimizationPasses = jitIrOptimizationPasses;
export const jitIrPassOptimizationPassOrder = jitIrOptimizationPassOrder;

export type JitIrOptimizationPassName = typeof jitIrOptimizationPassOrder[number];

export type JitIrOptimizationPipelineResult = Readonly<{
  block: JitOptimizedIrBlock;
  passResults: readonly JitOptimizationPassRun[];
  stats: JitPassStatsByName;
}>;

export type JitIrPassOptimizationPipelineResult = JitIrOptimizationPipelineResult;

export function runJitIrOptimizationPipeline(
  block: JitIrBlock,
  context: JitPassContext = {}
): JitIrOptimizationPipelineResult {
  return runJitIrPassOptimizationPipeline(block, context);
}

export function runJitIrPassOptimizationPipeline(
  block: JitIrBlock,
  context: JitPassContext = {}
): JitIrPassOptimizationPipelineResult {
  const result = runJitOptimizationPasses(block, jitIrOptimizationPasses, context);

  verifyJitIrBlock(result.block, { phase: "final" });

  return {
    block: toOptimizedBlock(result.block),
    passResults: result.passes,
    stats: collectJitPassStats(result.passes)
  };
}

function toOptimizedBlock(block: JitIrBlock): JitOptimizedIrBlock {
  return {
    instructions: block.instructions.map((instruction) => ({
      ...instruction,
      prelude: []
    }))
  };
}
