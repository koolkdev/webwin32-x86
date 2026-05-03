import {
  analyzeIrFlagLiveness,
  conditionFlagReadMask,
  IR_ALU_FLAG_MASKS,
  IR_FLAG_MASK_NONE,
  irIndexedFlagPointMasks,
  irOpFlagEffect,
  type IrFlagLivenessOptions
} from "./flag-analysis.js";
import { canUseFlagProducerCondition } from "#x86/ir/model/flag-conditions.js";
import { createIrFlagProducerConditionOp } from "#x86/ir/model/flags.js";
import type { IrBlockOptimizationPass, IrBlockOptimizationResult } from "./optimization.js";
import type { FlagMask, IrFlagSetOp, IrOp, IrBlock } from "#x86/ir/model/types.js";

export type DeadFlagSetPruningOptions = IrFlagLivenessOptions;

export type IrFlagPruneResult = IrBlockOptimizationResult & Readonly<{
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
  | ((block: IrBlock) => readonly Point[]);

export type IrFlagMaterializationOptions = Readonly<{
  points?: IrFlagPointSource<IrFlagMaterializationPoint>;
}>;

export type IrFlagBoundaryInsertionOptions = Readonly<{
  points?: IrFlagPointSource<IrFlagBoundaryPoint>;
}>;

export type IrFlagMaterializationResult = IrBlockOptimizationResult & Readonly<{
  insertedCount: number;
}>;

export type IrFlagBoundaryInsertionResult = IrBlockOptimizationResult & Readonly<{
  insertedCount: number;
}>;

export type IrAluFlagsConditionSpecializationResult = IrBlockOptimizationResult & Readonly<{
  specializedCount: number;
}>;

type FlagSource =
  | Readonly<{ kind: "incoming" }>
  | Readonly<{ kind: "producer"; descriptor: IrFlagSetOp }>;

export function createDeadFlagSetPruningPass(
  options: DeadFlagSetPruningOptions = {}
): IrBlockOptimizationPass {
  return (block) => pruneDeadFlagSets(block, options);
}

export function createFlagMaterializationPass(
  options: IrFlagMaterializationOptions = {}
): IrBlockOptimizationPass {
  return (block) => insertFlagMaterializations(block, options);
}

export function createFlagBoundaryInsertionPass(
  options: IrFlagBoundaryInsertionOptions = {}
): IrBlockOptimizationPass {
  return (block) => insertFlagBoundaries(block, options);
}

export function createAluFlagsConditionSpecializationPass(): IrBlockOptimizationPass {
  return specializeAluFlagsConditions;
}

export function pruneDeadFlagSets(
  block: IrBlock,
  options: DeadFlagSetPruningOptions = {}
): IrFlagPruneResult {
  const liveness = analyzeIrFlagLiveness(block, options);
  const optimized: IrOp[] = [];
  let prunedCount = 0;

  for (let index = 0; index < block.length; index += 1) {
    const op = block[index];
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

  return { block: optimized, prunedCount };
}

export function insertFlagMaterializations(
  block: IrBlock,
  options: IrFlagMaterializationOptions = {}
): IrFlagMaterializationResult {
  const pointMasks = flagMaterializationPointMasks(block, resolveFlagPoints(block, options.points));
  const optimized: IrOp[] = [];
  let pendingFlags = false;
  let availableFlags = IR_FLAG_MASK_NONE;
  let insertedCount = 0;

  for (let index = 0; index < block.length; index += 1) {
    const op = block[index];

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

  return { block: optimized, insertedCount };
}

export function insertFlagBoundaries(
  block: IrBlock,
  options: IrFlagBoundaryInsertionOptions = {}
): IrFlagBoundaryInsertionResult {
  const pointMasks = flagBoundaryPointMasks(block, resolveFlagPoints(block, options.points));
  const optimized: IrOp[] = [];
  let insertedCount = 0;

  for (let index = 0; index < block.length; index += 1) {
    const boundaryMask = pointMasks[index]!;

    if (boundaryMask !== IR_FLAG_MASK_NONE) {
      optimized.push({ op: "flags.boundary", mask: boundaryMask });
      insertedCount += 1;
    }

    const op = block[index];

    if (op === undefined) {
      throw new Error(`missing IR op while inserting flag boundaries: ${index}`);
    }

    optimized.push(op);
  }

  return { block: optimized, insertedCount };
}

export function specializeAluFlagsConditions(block: IrBlock): IrAluFlagsConditionSpecializationResult {
  const optimized: IrOp[] = [];
  const flagSources = new Map<number, FlagSource>(
    aluFlagMasks.map((mask) => [mask, incomingFlagSource])
  );
  let specializedCount = 0;

  for (let index = 0; index < block.length; index += 1) {
    const op = block[index];

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

  return { block: optimized, specializedCount };
}

function flagMaterializationPointMasks(
  block: IrBlock,
  points: readonly IrFlagMaterializationPoint[]
): readonly FlagMask[] {
  return irIndexedFlagPointMasks(block, points, "IR flag materialization point").before;
}

function flagBoundaryPointMasks(
  block: IrBlock,
  points: readonly IrFlagBoundaryPoint[]
): readonly FlagMask[] {
  return irIndexedFlagPointMasks(block, points, "IR flag boundary point").before;
}

function implicitMaterializationReadMask(op: IrOp): FlagMask {
  return op.op === "flags.boundary" || op.op === "flags.materialize"
    ? IR_FLAG_MASK_NONE
    : irOpFlagEffect(op).reads;
}

function resolveFlagPoints<Point>(
  block: IrBlock,
  points: IrFlagPointSource<Point> | undefined
): readonly Point[] {
  return typeof points === "function" ? points(block) : points ?? [];
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
