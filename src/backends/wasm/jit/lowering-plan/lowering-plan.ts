import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { analyzeJitLoweringState } from "./exit-state-analysis.js";
import type { JitLoweringPlan } from "./types.js";

export type {
  JitExitPoint,
  JitExitSnapshotKind,
  JitExitState,
  JitFlagMaterializationRequirement,
  JitFlagSnapshot,
  JitInstructionState,
  JitLoweringPlan,
  JitStateSnapshot
} from "./types.js";

export function planJitLowering(optimizedBlock: JitIrBlock): JitLoweringPlan {
  const state = analyzeJitLoweringState(optimizedBlock);

  return {
    ...state,
    block: optimizedBlock
  };
}
