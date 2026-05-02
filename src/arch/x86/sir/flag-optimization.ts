import {
  analyzeSirFlagLiveness,
  conditionFlagReadMask,
  SIR_ALU_FLAG_MASKS,
  SIR_FLAG_MASK_NONE,
  sirIndexedFlagPointMasks,
  sirOpFlagEffect,
  type SirFlagLivenessOptions
} from "./flag-analysis.js";
import { canUseFlagProducerCondition } from "./flag-conditions.js";
import { createSirFlagProducerConditionOp } from "./flags.js";
import type { SirOptimizationPass, SirOptimizationResult } from "./optimization.js";
import type { FlagMask, SirFlagSetOp, SirOp, SirProgram } from "./types.js";

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

export type SirAluFlagsConditionSpecializationResult = SirOptimizationResult & Readonly<{
  specializedCount: number;
}>;

type FlagSource =
  | Readonly<{ kind: "incoming" }>
  | Readonly<{ kind: "producer"; descriptor: SirFlagSetOp }>;

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

export function createAluFlagsConditionSpecializationPass(): SirOptimizationPass {
  return specializeAluFlagsConditions;
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

export function specializeAluFlagsConditions(program: SirProgram): SirAluFlagsConditionSpecializationResult {
  const optimized: SirOp[] = [];
  const flagSources = new Map<number, FlagSource>(
    aluFlagMasks.map((mask) => [mask, incomingFlagSource])
  );
  let specializedCount = 0;

  for (let index = 0; index < program.length; index += 1) {
    const op = program[index];

    if (op === undefined) {
      throw new Error(`missing SIR op while specializing flag conditions: ${index}`);
    }

    if (op.op === "aluFlags.condition") {
      const descriptor = commonProducerSource(flagSources, conditionFlagReadMask(op.cc));

      if (descriptor !== undefined && canUseFlagProducerCondition(descriptor, op.cc)) {
        optimized.push(createSirFlagProducerConditionOp(op.dst, op.cc, descriptor));
        specializedCount += 1;
        continue;
      }
    }

    optimized.push(op);

    if (op.op === "flags.set") {
      setSource(flagSources, op.writtenMask | op.undefMask, { kind: "producer", descriptor: op });
    }
  }

  return { program: optimized, specializedCount };
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

function commonProducerSource(
  flagSources: ReadonlyMap<number, FlagSource>,
  mask: FlagMask
): SirFlagSetOp | undefined {
  let descriptor: SirFlagSetOp | undefined;

  for (const flagMask of aluFlagMasks) {
    if ((mask & flagMask) === 0) {
      continue;
    }

    const source = flagSources.get(flagMask);

    if (source === undefined || source.kind !== "producer") {
      return undefined;
    }

    if (descriptor === undefined) {
      descriptor = source.descriptor;
    } else if (descriptor !== source.descriptor) {
      return undefined;
    }
  }

  return descriptor;
}

function setSource(flagSources: Map<number, FlagSource>, mask: FlagMask, source: FlagSource): void {
  for (const flagMask of aluFlagMasks) {
    if ((mask & flagMask) !== 0) {
      flagSources.set(flagMask, source);
    }
  }
}

const aluFlagMasks = Object.values(SIR_ALU_FLAG_MASKS);
const incomingFlagSource = { kind: "incoming" } as const satisfies FlagSource;
