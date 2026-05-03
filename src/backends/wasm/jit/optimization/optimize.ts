import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { pruneDeadJitFlags } from "./flag-pruning.js";
import { analyzeJitBlockState } from "./state-analysis.js";
import type { JitBlockOptimization } from "./types.js";
import { foldJitVirtualRegisters } from "./virtual-registers.js";

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
  const folded = foldJitVirtualRegisters(block);
  const pruned = pruneDeadJitFlags(folded.block);
  const optimized = analyzeJitBlockState(pruned.block);

  return {
    ...optimized,
    block: pruned.block
  };
}
