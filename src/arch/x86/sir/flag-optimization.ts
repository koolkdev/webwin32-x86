import {
  analyzeSirFlagLiveness,
  SIR_FLAG_MASK_NONE,
  sirOpFlagEffect,
  type SirFlagLivenessOptions
} from "./flag-analysis.js";
import type { SirOptimizationPass, SirOptimizationResult } from "./optimization.js";
import type { FlagMask, SirOp, SirProgram } from "./types.js";

export type DeadFlagSetPruningOptions = SirFlagLivenessOptions;

export type SirFlagPruneResult = SirOptimizationResult & Readonly<{
  prunedCount: number;
}>;

export type SirFlagMaterializationPoint = Readonly<{
  index: number;
  placement: "before";
  mask: FlagMask;
}>;

export type SirFlagMaterializationOptions = Readonly<{
  points?: readonly SirFlagMaterializationPoint[];
}>;

export type SirFlagMaterializationResult = SirOptimizationResult & Readonly<{
  insertedCount: number;
}>;

export function createDeadFlagSetPruningPass(
  options: DeadFlagSetPruningOptions = {}
): SirOptimizationPass {
  return (program) => pruneDeadFlagSets(program, options);
}

export function createFlagMaterializationPass(
  options: SirFlagMaterializationOptions = {}
): SirOptimizationPass {
  return (program) => insertFlagMaterializations(program, options);
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

export function insertFlagMaterializations(
  program: SirProgram,
  options: SirFlagMaterializationOptions = {}
): SirFlagMaterializationResult {
  const pointMasks = flagMaterializationPointMasks(program, options.points ?? []);
  const optimized: SirOp[] = [];
  const opBoundaryMap: number[] = [];
  let pendingFlags = false;
  let insertedCount = 0;

  for (let index = 0; index < program.length; index += 1) {
    const op = program[index];

    if (op === undefined) {
      throw new Error(`missing SIR op while inserting flag materializations: ${index}`);
    }

    opBoundaryMap.push(optimized.length);

    const materializeMask = pointMasks[index]! | sirOpFlagEffect(op).reads;

    if (pendingFlags && materializeMask !== SIR_FLAG_MASK_NONE) {
      optimized.push({ op: "flags.materialize", mask: materializeMask });
      pendingFlags = false;
      insertedCount += 1;
    }

    optimized.push(op);

    if (op.op === "flags.set") {
      pendingFlags = true;
    } else if (op.op === "flags.materialize") {
      pendingFlags = false;
    }
  }

  opBoundaryMap.push(optimized.length);

  return { program: optimized, opBoundaryMap, insertedCount };
}

function flagMaterializationPointMasks(
  program: SirProgram,
  points: readonly SirFlagMaterializationPoint[]
): readonly FlagMask[] {
  const masks = Array.from({ length: program.length }, () => SIR_FLAG_MASK_NONE);

  for (const point of points) {
    if (!Number.isInteger(point.index) || point.index < 0 || point.index >= program.length) {
      throw new Error(`SIR flag materialization point index out of range: ${point.index}`);
    }

    masks[point.index] = masks[point.index]! | point.mask;
  }

  return masks;
}
