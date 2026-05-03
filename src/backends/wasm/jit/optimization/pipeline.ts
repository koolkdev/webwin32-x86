import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { materializeJitVirtualFlags, type JitVirtualFlagMaterialization } from "./virtual-flags.js";
import { foldJitVirtualRegisters, type JitVirtualRegisterFolding } from "./virtual-registers.js";

export const jitIrOptimizationPassOrder = [
  "virtual-flags",
  "virtual-registers"
] as const;

export type JitIrOptimizationPassName = typeof jitIrOptimizationPassOrder[number];

export type JitIrOptimizationPipelineResult = Readonly<{
  block: JitIrBlock;
  passes: Readonly<{
    virtualFlags: JitVirtualFlagMaterialization;
    virtualRegisters: JitVirtualRegisterFolding;
  }>;
}>;

export function runJitIrOptimizationPipeline(block: JitIrBlock): JitIrOptimizationPipelineResult {
  const virtualFlags = materializeJitVirtualFlags(block);
  const virtualRegisters = foldJitVirtualRegisters(virtualFlags.block);

  return {
    block: virtualRegisters.block,
    passes: {
      virtualFlags: virtualFlags.flags,
      virtualRegisters: virtualRegisters.folding
    }
  };
}
