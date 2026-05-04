import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import type { JitLoweringPlan } from "./types.js";
import { insertJitFlagBoundaries } from "./flag-boundaries.js";

export function buildJitLoweringIr(loweringPlan: JitLoweringPlan): JitIrBlock {
  return insertJitFlagBoundaries(loweringPlan.block, loweringPlan);
}
