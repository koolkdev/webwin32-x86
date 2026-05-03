import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { pruneDeadJitFlags } from "./flag-pruning.js";
import { analyzeJitBlockState } from "./state-analysis.js";
import type { JitBlockOptimization } from "./types.js";

export type {
  JitBlockOptimization,
  JitExitPoint,
  JitExitSnapshotKind,
  JitExitState,
  JitFlagMaterializationRequirement,
  JitFlagSnapshot,
  JitInstructionState,
  JitStateSnapshot
} from "./types.js";

export function optimizeJitIrBlock(block: JitIrBlock): JitBlockOptimization {
  const pruned = pruneDeadJitFlags(block);
  const optimized = analyzeJitBlockState(pruned.block);

  return {
    ...optimized,
    block: pruned.block
  };
}
