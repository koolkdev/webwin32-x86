import { x86ArithmeticFlags } from "../isa/flags.js";
import { CONDITIONS } from "./conditions.js";
import { FLAG_PRODUCERS, type FlagName } from "./flags.js";
import type {
  ConditionCode,
  FlagProducerName,
  SirOp,
  SirProgram
} from "./types.js";

export type SirFlagMask = number;

export type SirFlagOpEffect = Readonly<{
  reads: SirFlagMask;
  writes: SirFlagMask;
  undefines: SirFlagMask;
}>;

export type SirFlagOpLiveness = SirFlagOpEffect &
  Readonly<{
    liveIn: SirFlagMask;
    liveOut: SirFlagMask;
    neededWrites: SirFlagMask;
    deadWrites: SirFlagMask;
  }>;

export type SirFlagLivenessOptions = Readonly<{
  liveOut?: SirFlagMask;
  barriers?: readonly SirFlagLivenessBarrier[];
}>;

export type SirIndexedFlagPoint = Readonly<{
  index: number;
  placement: "before" | "after";
  mask: SirFlagMask;
}>;

export type SirFlagLivenessBarrier = SirIndexedFlagPoint;

export type SirIndexedFlagPointMasks = Readonly<{
  before: readonly SirFlagMask[];
  after: readonly SirFlagMask[];
}>;

export const SIR_FLAG_MASK_NONE = 0;
export const SIR_ALU_FLAGS = x86ArithmeticFlags satisfies readonly FlagName[];
export const SIR_ALU_FLAG_MASKS = {
  CF: 1 << 0,
  PF: 1 << 1,
  AF: 1 << 2,
  ZF: 1 << 3,
  SF: 1 << 4,
  OF: 1 << 5
} as const satisfies Readonly<Record<FlagName, SirFlagMask>>;
export const SIR_ALU_FLAG_MASK = maskSirAluFlags(SIR_ALU_FLAGS);

const noFlagEffect = {
  reads: SIR_FLAG_MASK_NONE,
  writes: SIR_FLAG_MASK_NONE,
  undefines: SIR_FLAG_MASK_NONE
} as const satisfies SirFlagOpEffect;

export function maskSirAluFlags(flags: Iterable<FlagName>): SirFlagMask {
  let mask = SIR_FLAG_MASK_NONE;

  for (const flag of flags) {
    mask |= SIR_ALU_FLAG_MASKS[flag];
  }

  return mask;
}

export function assertSirAluFlagMask(mask: SirFlagMask, context = "SIR aluFlags mask"): void {
  if (!Number.isInteger(mask) || mask < 0 || (mask & ~SIR_ALU_FLAG_MASK) !== 0) {
    throw new Error(`${context} must contain only SIR aluFlags bits`);
  }
}

export function conditionFlagReadMask(cc: ConditionCode): SirFlagMask {
  return maskSirAluFlags(CONDITIONS[cc].reads);
}

export function flagProducerEffect(producer: FlagProducerName): SirFlagOpEffect {
  const flagProducer = FLAG_PRODUCERS[producer];

  return {
    reads: SIR_FLAG_MASK_NONE,
    writes: flagProducer.writtenMask,
    undefines: flagProducer.undefMask
  };
}

export function sirOpFlagEffect(op: SirOp): SirFlagOpEffect {
  switch (op.op) {
    case "flags.set":
      return {
        reads: SIR_FLAG_MASK_NONE,
        writes: op.writtenMask,
        undefines: op.undefMask
      };
    case "flagProducer.condition":
      return noFlagEffect;
    case "aluFlags.condition":
      return {
        reads: conditionFlagReadMask(op.cc),
        writes: SIR_FLAG_MASK_NONE,
        undefines: SIR_FLAG_MASK_NONE
      };
    case "flags.materialize":
      return {
        reads: op.mask,
        writes: SIR_FLAG_MASK_NONE,
        undefines: SIR_FLAG_MASK_NONE
      };
    case "flags.boundary":
      return {
        reads: op.mask,
        writes: SIR_FLAG_MASK_NONE,
        undefines: SIR_FLAG_MASK_NONE
      };
    default:
      return noFlagEffect;
  }
}

export function analyzeSirFlagEffects(program: SirProgram): readonly SirFlagOpEffect[] {
  return program.map(sirOpFlagEffect);
}

export function analyzeSirFlagLiveness(
  program: SirProgram,
  options: SirFlagLivenessOptions = {}
): readonly SirFlagOpLiveness[] {
  const effects = analyzeSirFlagEffects(program);
  const barriers = flagBarriersByIndex(program, options.barriers ?? []);
  const liveness: SirFlagOpLiveness[] = new Array(program.length);
  const liveOutOption = options.liveOut ?? SIR_FLAG_MASK_NONE;

  assertSirAluFlagMask(liveOutOption, "SIR flag liveness liveOut");

  let live = liveOutOption;

  for (let index = program.length - 1; index >= 0; index -= 1) {
    const effect = effects[index];

    if (effect === undefined) {
      throw new Error(`missing SIR flag effect for op: ${index}`);
    }

    const liveOut = live | barriers.after[index]!;
    const killed = effect.writes | effect.undefines;
    const liveIn = barriers.before[index]! | effect.reads | (liveOut & ~killed);
    const neededWrites = effect.writes & liveOut;
    const deadWrites = effect.writes & ~liveOut;

    liveness[index] = { ...effect, liveIn, liveOut, neededWrites, deadWrites };
    live = liveIn;
  }

  return liveness;
}

function flagBarriersByIndex(
  program: SirProgram,
  barriers: readonly SirFlagLivenessBarrier[]
): SirIndexedFlagPointMasks {
  return sirIndexedFlagPointMasks(program, barriers, "SIR flag liveness barrier");
}

export function sirIndexedFlagPointMasks(
  program: SirProgram,
  points: readonly SirIndexedFlagPoint[],
  label: string
): SirIndexedFlagPointMasks {
  const before = Array.from({ length: program.length }, () => SIR_FLAG_MASK_NONE);
  const after = Array.from({ length: program.length }, () => SIR_FLAG_MASK_NONE);

  for (const point of points) {
    if (!Number.isInteger(point.index) || point.index < 0 || point.index >= program.length) {
      throw new Error(`${label} index out of range: ${point.index}`);
    }

    const target = point.placement === "before" ? before : after;

    assertSirAluFlagMask(point.mask, `${label} mask`);
    target[point.index] = target[point.index]! | point.mask;
  }

  return { before, after };
}
