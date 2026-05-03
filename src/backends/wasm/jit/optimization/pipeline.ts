import type { JitIrBlock, JitOptimizedIrBlock } from "#backends/wasm/jit/types.js";
import { analyzeJitOptimization } from "./analysis.js";
import { pruneDeadJitLocalValues, type JitDeadLocalValuePruning } from "./dead-local-values.js";
import { materializeJitVirtualFlags, type JitVirtualFlagMaterialization } from "./virtual-flags.js";
import { foldJitVirtualRegisters, type JitVirtualRegisterFolding } from "./virtual-registers.js";

export const jitIrOptimizationPassOrder = [
  "virtual-flags",
  "dead-local-values",
  "virtual-registers"
] as const;

export type JitIrOptimizationPassName = typeof jitIrOptimizationPassOrder[number];

export type JitIrOptimizationPipelineResult = Readonly<{
  block: JitOptimizedIrBlock;
  passes: Readonly<{
    virtualFlags: JitVirtualFlagMaterialization;
    deadLocalValues: JitDeadLocalValuePruning;
    virtualRegisters: JitVirtualRegisterFolding;
  }>;
}>;

export function runJitIrOptimizationPipeline(block: JitIrBlock): JitIrOptimizationPipelineResult {
  const initialAnalysis = analyzeJitOptimization(block);
  const virtualFlags = materializeJitVirtualFlags(block, initialAnalysis);
  const deadLocalValues = pruneDeadJitLocalValues(virtualFlags.block);
  const registerAnalysis = analyzeJitOptimization(deadLocalValues.block);
  const virtualRegisters = foldJitVirtualRegisters(
    deadLocalValues.block,
    registerAnalysis
  );

  return {
    block: virtualRegisters.block,
    passes: {
      virtualFlags: virtualFlags.flags,
      deadLocalValues: deadLocalValues.deadLocalValues,
      virtualRegisters: virtualRegisters.folding
    }
  };
}
