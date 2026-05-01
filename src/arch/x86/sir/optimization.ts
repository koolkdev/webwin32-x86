import type { SirProgram } from "./types.js";

export type SirOptimizationResult = Readonly<{
  program: SirProgram;
}>;

export type SirOptimizationPass = (program: SirProgram) => SirOptimizationResult;

export function optimizeSirProgram(
  program: SirProgram,
  passes: readonly SirOptimizationPass[]
): SirOptimizationResult {
  let optimizedProgram = program;

  for (const pass of passes) {
    const result = pass(optimizedProgram);

    optimizedProgram = result.program;
  }

  return { program: optimizedProgram };
}
