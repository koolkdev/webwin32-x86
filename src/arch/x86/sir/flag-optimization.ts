import {
  analyzeSirFlagLiveness,
  SIR_FLAG_MASK_NONE,
  type SirFlagLivenessOptions
} from "./flag-analysis.js";
import type { SirOptimizationPass, SirOptimizationResult } from "./optimization.js";
import type { SirOp, SirProgram } from "./types.js";

export type DeadFlagSetPruningOptions = SirFlagLivenessOptions;

export type SirFlagPruneResult = SirOptimizationResult & Readonly<{
  prunedCount: number;
}>;

export function createDeadFlagSetPruningPass(
  options: DeadFlagSetPruningOptions = {}
): SirOptimizationPass {
  return (program) => pruneDeadFlagSets(program, options);
}

export function pruneDeadFlagSets(
  program: SirProgram,
  options: DeadFlagSetPruningOptions = {}
): SirFlagPruneResult {
  const liveness = analyzeSirFlagLiveness(program, options);
  const optimized: SirOp[] = [];
  const opBoundaryMap: number[] = [];
  let prunedCount = 0;

  for (let index = 0; index < program.length; index += 1) {
    const op = program[index];
    const flags = liveness[index];

    if (op === undefined || flags === undefined) {
      throw new Error(`missing SIR op while pruning dead flags: ${index}`);
    }

    opBoundaryMap.push(optimized.length);

    if (op.op === "flags.set" && flags.neededWrites === SIR_FLAG_MASK_NONE) {
      prunedCount += 1;
      continue;
    }

    optimized.push(op);
  }

  opBoundaryMap.push(optimized.length);

  return { program: optimized, opBoundaryMap, prunedCount };
}
