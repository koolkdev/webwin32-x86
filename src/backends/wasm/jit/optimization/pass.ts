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

export type JitOptimizationPass<TName extends string = string> = Readonly<{
  name: TName;
  run(block: JitIrBlock, context: JitPassContext): JitPassResult;
}>;

export type JitOptimizationPassRun<TName extends string = string> = JitNamedPassStats<TName>;

export type JitOptimizationPassPipelineResult<TName extends string = string> = Readonly<{
  block: JitIrBlock;
  changed: boolean;
  passes: readonly JitOptimizationPassRun<TName>[];
}>;

export function runJitOptimizationPasses<const TPasses extends readonly JitOptimizationPass[]>(
  block: JitIrBlock,
  passes: TPasses,
  context: JitPassContext = {}
): JitOptimizationPassPipelineResult<TPasses[number]["name"]> {
  let current = block;
  let changed = false;
  const results: JitOptimizationPassRun<TPasses[number]["name"]>[] = [];

  for (const pass of passes) {
    if (context.validate === true) {
      verifyJitIrBlock(current, {
        phase: "before-pass",
        passName: pass.name
      });
    }

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
