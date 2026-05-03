import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import {
  analyzeJitOptimization,
  type JitOptimizationAnalysis
} from "#backends/wasm/jit/optimization/tracked/analysis.js";
import { emitJitFlagMaterializationFromPlan } from "#backends/wasm/jit/optimization/planner/emitter.js";
import { planJitOptimization } from "#backends/wasm/jit/optimization/planner/planner.js";

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
  return emitJitFlagMaterializationFromPlan(
    planJitOptimization(block, optimizationAnalysis),
    optimizationAnalysis
  );
}
