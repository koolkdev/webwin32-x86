import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import {
  indexJitOptimizationEvents,
  type JitOptimizationEventIndex
} from "./events.js";

export type JitOptimizationAnalysis = Readonly<{
  events: JitOptimizationEventIndex;
}>;

export function analyzeJitOptimization(block: JitIrBlock): JitOptimizationAnalysis {
  return {
    events: indexJitOptimizationEvents(block)
  };
}
