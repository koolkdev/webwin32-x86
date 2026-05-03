import type { JitIrBlock, JitOptimizedIrBlock } from "#backends/wasm/jit/types.js";
import { analyzeJitOptimization } from "./analysis.js";
import { pruneDeadJitLocalValues, type JitDeadLocalValuePruning } from "./dead-local-values.js";
import { materializeJitFlags, type JitFlagMaterialization } from "./flags.js";
import { foldJitRegisters, type JitRegisterFolding } from "./register-folding.js";

export const jitIrOptimizationPassOrder = [
  "flag-materialization",
  "dead-local-values",
  "register-folding"
] as const;

export type JitIrOptimizationPassName = typeof jitIrOptimizationPassOrder[number];

export type JitIrOptimizationPipelineResult = Readonly<{
  block: JitOptimizedIrBlock;
  passes: Readonly<{
    flagMaterialization: JitFlagMaterialization;
    deadLocalValues: JitDeadLocalValuePruning;
    registerFolding: JitRegisterFolding;
  }>;
}>;

export function runJitIrOptimizationPipeline(block: JitIrBlock): JitIrOptimizationPipelineResult {
  const initialAnalysis = analyzeJitOptimization(block);
  const flagMaterialization = materializeJitFlags(block, initialAnalysis);
  const deadLocalValues = pruneDeadJitLocalValues(flagMaterialization.block);
  const registerAnalysis = analyzeJitOptimization(deadLocalValues.block);
  const registerFolding = foldJitRegisters(
    deadLocalValues.block,
    registerAnalysis
  );

  return {
    block: registerFolding.block,
    passes: {
      flagMaterialization: flagMaterialization.flags,
      deadLocalValues: deadLocalValues.deadLocalValues,
      registerFolding: registerFolding.folding
    }
  };
}
