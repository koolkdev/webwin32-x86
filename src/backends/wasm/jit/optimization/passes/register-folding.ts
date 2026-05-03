import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import {
  analyzeJitOptimization,
  type JitOptimizationAnalysis
} from "#backends/wasm/jit/optimization/tracked/analysis.js";
import { emitJitRegisterFolding } from "#backends/wasm/jit/optimization/planner/emitter.js";

export type JitRegisterFolding = Readonly<{
  removedSetCount: number;
  materializedSetCount: number;
}>;

export function foldJitRegisters(
  block: JitIrBlock,
  analysis: JitOptimizationAnalysis = analyzeJitOptimization(block)
) {
  return emitJitRegisterFolding(block, analysis);
}
