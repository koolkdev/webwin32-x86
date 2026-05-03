import type { JitIrBlock } from "#backends/wasm/jit/types.js";
import { analyzeJitOptimization } from "./analysis.js";
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
  const initialAnalysis = analyzeJitOptimization(block);
  const virtualFlags = materializeJitVirtualFlags(block, initialAnalysis);
  const registerAnalysis = analyzeJitOptimization(virtualFlags.block);
  const virtualRegisters = foldJitVirtualRegisters(
    virtualFlags.block,
    registerAnalysis
  );

  return {
    block: virtualRegisters.block,
    passes: {
      virtualFlags: virtualFlags.flags,
      virtualRegisters: virtualRegisters.folding
    }
  };
}
