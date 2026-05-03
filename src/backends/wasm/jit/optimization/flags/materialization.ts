import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import {
  analyzeJitOptimization,
  type JitOptimizationAnalysis
} from "#backends/wasm/jit/optimization/tracked/analysis.js";
import { emitJitFlagMaterialization } from "#backends/wasm/jit/optimization/planner/emitter.js";

export type JitFlagMaterialization = Readonly<{
  removedSetCount: number;
  retainedSetCount: number;
  directConditionCount: number;
  sourceClobberCount: number;
}>;

export function materializeJitFlags(
  block: JitIrBlock,
  optimizationAnalysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
) {
  return emitJitFlagMaterialization(block, optimizationAnalysis);
}
