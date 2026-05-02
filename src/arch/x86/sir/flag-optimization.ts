import {
  analyzeSirFlagLiveness,
  SIR_FLAG_MASK_NONE,
  sirIndexedFlagPointMasks,
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

export type SirFlagBoundaryPoint = Readonly<{
  index: number;
  placement: "before";
  mask: FlagMask;
}>;

export type SirFlagPointSource<Point> =
  | readonly Point[]
  | ((program: SirProgram) => readonly Point[]);

export type SirFlagMaterializationOptions = Readonly<{
  points?: SirFlagPointSource<SirFlagMaterializationPoint>;
}>;

export type SirFlagBoundaryInsertionOptions = Readonly<{
  points?: SirFlagPointSource<SirFlagBoundaryPoint>;
}>;

export type SirFlagMaterializationResult = SirOptimizationResult & Readonly<{
  insertedCount: number;
}>;

export type SirFlagBoundaryInsertionResult = SirOptimizationResult & Readonly<{
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

export function createFlagBoundaryInsertionPass(
  options: SirFlagBoundaryInsertionOptions = {}
): SirOptimizationPass {
  return (program) => insertFlagBoundaries(program, options);
}

export function pruneDeadFlagSets(
  program: SirProgram,
  options: DeadFlagSetPruningOptions = {}
): SirFlagPruneResult {
  const liveness = analyzeSirFlagLiveness(program, options);
  const optimized: SirOp[] = [];
  let prunedCount = 0;

  for (let index = 0; index < program.length; index += 1) {
    const op = program[index];
    const flags = liveness[index];

    if (op === undefined || flags === undefined) {
      throw new Error(`missing SIR op while pruning dead flags: ${index}`);
    }

    if (op.op === "flags.set" && flags.neededWrites === SIR_FLAG_MASK_NONE) {
      prunedCount += 1;
      continue;
    }

    optimized.push(op);
  }

  return { program: optimized, prunedCount };
}

export function insertFlagMaterializations(
  program: SirProgram,
  options: SirFlagMaterializationOptions = {}
): SirFlagMaterializationResult {
  const pointMasks = flagMaterializationPointMasks(program, resolveFlagPoints(program, options.points));
  const optimized: SirOp[] = [];
  let pendingFlags = false;
  let availableFlags = SIR_FLAG_MASK_NONE;
  let insertedCount = 0;

  for (let index = 0; index < program.length; index += 1) {
    const op = program[index];

    if (op === undefined) {
      throw new Error(`missing SIR op while inserting flag materializations: ${index}`);
    }

    const materializeMask = pointMasks[index]! | implicitMaterializationReadMask(op);
    const missingMaterializeMask = materializeMask & ~availableFlags;

    if (missingMaterializeMask !== SIR_FLAG_MASK_NONE) {
      optimized.push({ op: "flags.materialize", mask: missingMaterializeMask });
      pendingFlags = false;
      availableFlags |= missingMaterializeMask;
      insertedCount += 1;
    }

    optimized.push(op);

    if (op.op === "flags.set") {
      pendingFlags = true;
      availableFlags = SIR_FLAG_MASK_NONE;
    } else if (op.op === "flags.materialize") {
      pendingFlags = false;
      availableFlags |= op.mask;
    } else if (op.op === "flags.boundary" && pendingFlags) {
      pendingFlags = false;
      availableFlags |= op.mask;
    }
  }

  return { program: optimized, insertedCount };
}

export function insertFlagBoundaries(
  program: SirProgram,
  options: SirFlagBoundaryInsertionOptions = {}
): SirFlagBoundaryInsertionResult {
  const pointMasks = flagBoundaryPointMasks(program, resolveFlagPoints(program, options.points));
  const optimized: SirOp[] = [];
  let insertedCount = 0;

  for (let index = 0; index < program.length; index += 1) {
    const boundaryMask = pointMasks[index]!;

    if (boundaryMask !== SIR_FLAG_MASK_NONE) {
      optimized.push({ op: "flags.boundary", mask: boundaryMask });
      insertedCount += 1;
    }

    const op = program[index];

    if (op === undefined) {
      throw new Error(`missing SIR op while inserting flag boundaries: ${index}`);
    }

    optimized.push(op);
  }

  return { program: optimized, insertedCount };
}

function flagMaterializationPointMasks(
  program: SirProgram,
  points: readonly SirFlagMaterializationPoint[]
): readonly FlagMask[] {
  return sirIndexedFlagPointMasks(program, points, "SIR flag materialization point").before;
}

function flagBoundaryPointMasks(
  program: SirProgram,
  points: readonly SirFlagBoundaryPoint[]
): readonly FlagMask[] {
  return sirIndexedFlagPointMasks(program, points, "SIR flag boundary point").before;
}

function implicitMaterializationReadMask(op: SirOp): FlagMask {
  return op.op === "flags.boundary" || op.op === "flags.materialize"
    ? SIR_FLAG_MASK_NONE
    : sirOpFlagEffect(op).reads;
}

function resolveFlagPoints<Point>(
  program: SirProgram,
  points: SirFlagPointSource<Point> | undefined
): readonly Point[] {
  return typeof points === "function" ? points(program) : points ?? [];
}
