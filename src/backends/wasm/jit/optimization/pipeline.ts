import type { JitIrBlock, JitOptimizedIrBlock } from "#backends/wasm/jit/types.js";
import { analyzeJitOptimization } from "./analysis.js";
import { pruneDeadJitLocalValues, type JitDeadLocalValuePruning } from "./dead-local-values.js";
import { materializeJitVirtualFlags, type JitVirtualFlagMaterialization } from "./virtual-flags.js";
import { foldJitRegisters, type JitRegisterFolding } from "./register-folding.js";

export const jitIrOptimizationPassOrder = [
  "virtual-flags",
  "dead-local-values",
  "register-folding"
] as const;

export type JitIrOptimizationPassName = typeof jitIrOptimizationPassOrder[number];

export type JitIrOptimizationPipelineResult = Readonly<{
  block: JitOptimizedIrBlock;
  passes: Readonly<{
    virtualFlags: JitVirtualFlagMaterialization;
    deadLocalValues: JitDeadLocalValuePruning;
    registerFolding: JitRegisterFolding;
  }>;
}>;

export function runJitIrOptimizationPipeline(block: JitIrBlock): JitIrOptimizationPipelineResult {
  const initialAnalysis = analyzeJitOptimization(block);
  const virtualFlags = materializeJitVirtualFlags(block, initialAnalysis);
  const deadLocalValues = pruneDeadJitLocalValues(virtualFlags.block);
  const registerAnalysis = analyzeJitOptimization(deadLocalValues.block);
  const registerFolding = foldJitRegisters(
    deadLocalValues.block,
    registerAnalysis
  );

  return {
    block: registerFolding.block,
    passes: {
      virtualFlags: virtualFlags.flags,
      deadLocalValues: deadLocalValues.deadLocalValues,
      registerFolding: registerFolding.folding
    }
  };
}
