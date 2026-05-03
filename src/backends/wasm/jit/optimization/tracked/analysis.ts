import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import {
  createJitOptimizationContext,
  type JitOptimizationContext
} from "#backends/wasm/jit/optimization/tracked/context.js";

export type JitOptimizationAnalysis = Readonly<{
  context: JitOptimizationContext;
}>;

export function analyzeJitOptimization(block: JitIrBlock): JitOptimizationAnalysis {
  return {
    context: createJitOptimizationContext(block)
  };
}
