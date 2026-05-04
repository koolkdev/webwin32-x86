import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { runJitIrOptimizationPipeline } from "./pipeline.js";

export function optimizeJitIrBlock(block: JitIrBlock): JitIrBlock {
  return runJitIrOptimizationPipeline(block).block;
}
