import type { JitIrBlock } from "#backends/wasm/jit/ir/types.js";
import { analyzeJitCodegenState } from "./exit-state-analysis.js";
import type { JitCodegenPlan } from "./types.js";

export type {
  JitExitPoint,
  JitExitSnapshotKind,
  JitExitState,
  JitFlagMaterializationRequirement,
  JitFlagSnapshot,
  JitInstructionState,
  JitCodegenPlan,
  JitStateSnapshot
} from "./types.js";

export function planJitCodegen(optimizedBlock: JitIrBlock): JitCodegenPlan {
  const state = analyzeJitCodegenState(optimizedBlock);

  return {
    ...state,
    block: optimizedBlock
  };
}
