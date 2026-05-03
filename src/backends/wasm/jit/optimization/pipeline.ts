import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { pruneDeadJitFlags, type JitFlagPruning } from "./flag-pruning.js";
import { foldJitVirtualRegisters, type JitVirtualRegisterFolding } from "./virtual-registers.js";

export const jitIrOptimizationPassOrder = [
  "virtual-registers",
  "dead-flags"
] as const;

export type JitIrOptimizationPassName = typeof jitIrOptimizationPassOrder[number];

export type JitIrOptimizationPipelineResult = Readonly<{
  block: JitIrBlock;
  passes: Readonly<{
    virtualRegisters: JitVirtualRegisterFolding;
    deadFlags: JitFlagPruning;
  }>;
}>;

export function runJitIrOptimizationPipeline(block: JitIrBlock): JitIrOptimizationPipelineResult {
  const virtualRegisters = foldJitVirtualRegisters(block);
  const deadFlags = pruneDeadJitFlags(virtualRegisters.block);

  return {
    block: deadFlags.block,
    passes: {
      virtualRegisters: virtualRegisters.folding,
      deadFlags: deadFlags.pruning
    }
  };
}
