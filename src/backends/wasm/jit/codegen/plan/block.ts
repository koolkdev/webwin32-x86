import type { JitIrBlock } from "#backends/wasm/jit/ir/types.js";
import type { JitCodegenPlan } from "./types.js";
import { insertJitFlagBoundaries } from "./flag-boundaries.js";

export function buildJitCodegenIr(codegenPlan: JitCodegenPlan): JitIrBlock {
  return insertJitFlagBoundaries(codegenPlan.block, codegenPlan);
}
