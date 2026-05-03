import type { IrBlock } from "#x86/ir/model/types.js";

export type IrBlockOptimizationResult = Readonly<{
  block: IrBlock;
}>;

export type IrBlockOptimizationPass = (block: IrBlock) => IrBlockOptimizationResult;

export function optimizeIrBlock(
  block: IrBlock,
  passes: readonly IrBlockOptimizationPass[]
): IrBlockOptimizationResult {
  let optimizedBlock = block;

  for (const pass of passes) {
    const result = pass(optimizedBlock);

    optimizedBlock = result.block;
  }

  return { block: optimizedBlock };
}
