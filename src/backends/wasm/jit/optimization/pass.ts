import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { verifyJitIrBlock } from "#backends/wasm/jit/optimization/verify/optimizer-invariants.js";
import type { JitNamedPassStats, JitPassStats } from "./stats.js";

export type JitPassContext = Readonly<{
  validate?: boolean;
}>;

export type JitPassResult = Readonly<{
  block: JitIrBlock;
  changed: boolean;
  stats?: JitPassStats;
}>;

export type JitOptimizationPass = Readonly<{
  name: string;
  run(block: JitIrBlock, context: JitPassContext): JitPassResult;
}>;

export type JitOptimizationPassRun = JitNamedPassStats;

export type JitOptimizationPassPipelineResult = Readonly<{
  block: JitIrBlock;
  changed: boolean;
  passes: readonly JitOptimizationPassRun[];
}>;

export function runJitOptimizationPasses(
  block: JitIrBlock,
  passes: readonly JitOptimizationPass[],
  context: JitPassContext = {}
): JitOptimizationPassPipelineResult {
  let current = block;
  let changed = false;
  const results: JitOptimizationPassRun[] = [];

  for (const pass of passes) {
    const result = pass.run(current, context);
    const stats = result.stats ?? {};

    if (context.validate === true) {
      verifyJitIrBlock(result.block, {
        phase: "after-pass",
        passName: pass.name
      });
    }

    current = result.block;
    changed = changed || result.changed;
    results.push({
      name: pass.name,
      changed: result.changed,
      stats
    });
  }

  return {
    block: current,
    changed,
    passes: results
  };
}
