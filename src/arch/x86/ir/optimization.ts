import type { IrProgram } from "./types.js";

export type IrOptimizationResult = Readonly<{
  program: IrProgram;
}>;

export type IrOptimizationPass = (program: IrProgram) => IrOptimizationResult;

export function optimizeIrProgram(
  program: IrProgram,
  passes: readonly IrOptimizationPass[]
): IrOptimizationResult {
  let optimizedProgram = program;

  for (const pass of passes) {
    const result = pass(optimizedProgram);

    optimizedProgram = result.program;
  }

  return { program: optimizedProgram };
}
