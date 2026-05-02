import {
  analyzeIrFlagLiveness,
  conditionFlagReadMask,
  IR_ALU_FLAG_MASKS,
  IR_FLAG_MASK_NONE,
  irIndexedFlagPointMasks,
  irOpFlagEffect,
  type IrFlagLivenessOptions
} from "./flag-analysis.js";
import { canUseFlagProducerCondition } from "../model/flag-conditions.js";
import { createIrFlagProducerConditionOp } from "../model/flags.js";
import type { IrOptimizationPass, IrOptimizationResult } from "./optimization.js";
import type { FlagMask, IrFlagSetOp, IrOp, IrProgram } from "../model/types.js";

export type DeadFlagSetPruningOptions = IrFlagLivenessOptions;

export type IrFlagPruneResult = IrOptimizationResult & Readonly<{
  prunedCount: number;
}>;

export type IrFlagMaterializationPoint = Readonly<{
  index: number;
  placement: "before";
  mask: FlagMask;
}>;

export type IrFlagBoundaryPoint = Readonly<{
  index: number;
  placement: "before";
  mask: FlagMask;
}>;

export type IrFlagPointSource<Point> =
  | readonly Point[]
  | ((program: IrProgram) => readonly Point[]);

export type IrFlagMaterializationOptions = Readonly<{
  points?: IrFlagPointSource<IrFlagMaterializationPoint>;
}>;

export type IrFlagBoundaryInsertionOptions = Readonly<{
  points?: IrFlagPointSource<IrFlagBoundaryPoint>;
}>;

export type IrFlagMaterializationResult = IrOptimizationResult & Readonly<{
  insertedCount: number;
}>;

export type IrFlagBoundaryInsertionResult = IrOptimizationResult & Readonly<{
  insertedCount: number;
}>;

export type IrAluFlagsConditionSpecializationResult = IrOptimizationResult & Readonly<{
  specializedCount: number;
}>;

type FlagSource =
  | Readonly<{ kind: "incoming" }>
  | Readonly<{ kind: "producer"; descriptor: IrFlagSetOp }>;

export function createDeadFlagSetPruningPass(
  options: DeadFlagSetPruningOptions = {}
): IrOptimizationPass {
  return (program) => pruneDeadFlagSets(program, options);
}

export function createFlagMaterializationPass(
  options: IrFlagMaterializationOptions = {}
): IrOptimizationPass {
  return (program) => insertFlagMaterializations(program, options);
}

export function createFlagBoundaryInsertionPass(
  options: IrFlagBoundaryInsertionOptions = {}
): IrOptimizationPass {
  return (program) => insertFlagBoundaries(program, options);
}

export function createAluFlagsConditionSpecializationPass(): IrOptimizationPass {
  return specializeAluFlagsConditions;
}

export function pruneDeadFlagSets(
  program: IrProgram,
  options: DeadFlagSetPruningOptions = {}
): IrFlagPruneResult {
  const liveness = analyzeIrFlagLiveness(program, options);
  const optimized: IrOp[] = [];
  let prunedCount = 0;

  for (let index = 0; index < program.length; index += 1) {
    const op = program[index];
    const flags = liveness[index];

    if (op === undefined || flags === undefined) {
      throw new Error(`missing IR op while pruning dead flags: ${index}`);
    }

    if (op.op === "flags.set" && flags.neededWrites === IR_FLAG_MASK_NONE) {
      prunedCount += 1;
      continue;
    }

    optimized.push(op);
  }

  return { program: optimized, prunedCount };
}

export function insertFlagMaterializations(
  program: IrProgram,
  options: IrFlagMaterializationOptions = {}
): IrFlagMaterializationResult {
  const pointMasks = flagMaterializationPointMasks(program, resolveFlagPoints(program, options.points));
  const optimized: IrOp[] = [];
  let pendingFlags = false;
  let availableFlags = IR_FLAG_MASK_NONE;
  let insertedCount = 0;

  for (let index = 0; index < program.length; index += 1) {
    const op = program[index];

    if (op === undefined) {
      throw new Error(`missing IR op while inserting flag materializations: ${index}`);
    }

    const materializeMask = pointMasks[index]! | implicitMaterializationReadMask(op);
    const missingMaterializeMask = materializeMask & ~availableFlags;

    if (missingMaterializeMask !== IR_FLAG_MASK_NONE) {
      optimized.push({ op: "flags.materialize", mask: missingMaterializeMask });
      pendingFlags = false;
      availableFlags |= missingMaterializeMask;
      insertedCount += 1;
    }

    optimized.push(op);

    if (op.op === "flags.set") {
      pendingFlags = true;
      availableFlags = IR_FLAG_MASK_NONE;
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
  program: IrProgram,
  options: IrFlagBoundaryInsertionOptions = {}
): IrFlagBoundaryInsertionResult {
  const pointMasks = flagBoundaryPointMasks(program, resolveFlagPoints(program, options.points));
  const optimized: IrOp[] = [];
  let insertedCount = 0;

  for (let index = 0; index < program.length; index += 1) {
    const boundaryMask = pointMasks[index]!;

    if (boundaryMask !== IR_FLAG_MASK_NONE) {
      optimized.push({ op: "flags.boundary", mask: boundaryMask });
      insertedCount += 1;
    }

    const op = program[index];

    if (op === undefined) {
      throw new Error(`missing IR op while inserting flag boundaries: ${index}`);
    }

    optimized.push(op);
  }

  return { program: optimized, insertedCount };
}

export function specializeAluFlagsConditions(program: IrProgram): IrAluFlagsConditionSpecializationResult {
  const optimized: IrOp[] = [];
  const flagSources = new Map<number, FlagSource>(
    aluFlagMasks.map((mask) => [mask, incomingFlagSource])
  );
  let specializedCount = 0;

  for (let index = 0; index < program.length; index += 1) {
    const op = program[index];

    if (op === undefined) {
      throw new Error(`missing IR op while specializing flag conditions: ${index}`);
    }

    if (op.op === "aluFlags.condition") {
      const descriptor = commonProducerSource(flagSources, conditionFlagReadMask(op.cc));

      if (descriptor !== undefined && canUseFlagProducerCondition(descriptor, op.cc)) {
        optimized.push(createIrFlagProducerConditionOp(op.dst, op.cc, descriptor));
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
  program: IrProgram,
  points: readonly IrFlagMaterializationPoint[]
): readonly FlagMask[] {
  return irIndexedFlagPointMasks(program, points, "IR flag materialization point").before;
}

function flagBoundaryPointMasks(
  program: IrProgram,
  points: readonly IrFlagBoundaryPoint[]
): readonly FlagMask[] {
  return irIndexedFlagPointMasks(program, points, "IR flag boundary point").before;
}

function implicitMaterializationReadMask(op: IrOp): FlagMask {
  return op.op === "flags.boundary" || op.op === "flags.materialize"
    ? IR_FLAG_MASK_NONE
    : irOpFlagEffect(op).reads;
}

function resolveFlagPoints<Point>(
  program: IrProgram,
  points: IrFlagPointSource<Point> | undefined
): readonly Point[] {
  return typeof points === "function" ? points(program) : points ?? [];
}

function commonProducerSource(
  flagSources: ReadonlyMap<number, FlagSource>,
  mask: FlagMask
): IrFlagSetOp | undefined {
  let descriptor: IrFlagSetOp | undefined;

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

const aluFlagMasks = Object.values(IR_ALU_FLAG_MASKS);
const incomingFlagSource = { kind: "incoming" } as const satisfies FlagSource;
