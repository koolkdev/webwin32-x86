import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import {
  indexJitOptimizationBoundaries,
  type JitOptimizationBoundaryIndex
} from "./boundaries.js";

export type JitOptimizationAnalysis = Readonly<{
  boundaries: JitOptimizationBoundaryIndex;
}>;

export function analyzeJitOptimization(block: JitIrBlock): JitOptimizationAnalysis {
  return {
    boundaries: indexJitOptimizationBoundaries(block)
  };
}
