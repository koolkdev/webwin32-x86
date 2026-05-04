import type { JitIrBlock } from "#backends/wasm/jit/ir/types.js";
import { runJitIrOptimizationPipeline } from "./pipeline.js";

export function optimizeJitIrBlock(block: JitIrBlock): JitIrBlock {
  return runJitIrOptimizationPipeline(block).block;
}
