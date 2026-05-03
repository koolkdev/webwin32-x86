import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import {
  analyzeJitOptimization,
  type JitOptimizationAnalysis
} from "#backends/wasm/jit/optimization/tracked/analysis.js";
import { emitJitRegisterFoldingFromPlan } from "#backends/wasm/jit/optimization/planner/emitter.js";
import { planJitOptimization } from "#backends/wasm/jit/optimization/planner/planner.js";

export type JitRegisterFolding = Readonly<{
  removedSetCount: number;
  materializedSetCount: number;
}>;

export function foldJitRegisters(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
) {
  return emitJitRegisterFoldingFromPlan(
    planJitOptimization(block, analysis),
    analysis
  );
}
