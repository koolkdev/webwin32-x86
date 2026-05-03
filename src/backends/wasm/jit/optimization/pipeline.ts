import type { JitIrBlock } from "#backends/wasm/jit/types.js";
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

export type JitIrOptimizationPassName = typeof jitIrOptimizationPassOrder[number];

export type JitIrOptimizationPipelineResult = Readonly<{
  block: JitIrBlock;
  passResults: readonly JitOptimizationPassRun[];
  stats: JitPassStatsByName;
}>;

export function runJitIrOptimizationPipeline(
  block: JitIrBlock,
  context: JitPassContext = {}
): JitIrOptimizationPipelineResult {
  const result = runJitOptimizationPasses(block, jitIrOptimizationPasses, context);

  verifyJitIrBlock(result.block, { phase: "final" });

  return {
    block: result.block,
    passResults: result.passes,
    stats: collectJitPassStats(result.passes)
  };
}
