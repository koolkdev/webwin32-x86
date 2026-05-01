import { CONDITIONS } from "./conditions.js";
import {
  FLAG_PRODUCERS,
  type FlagName
} from "./flags.js";
import type {
  ConditionCode,
  FlagProducerName,
  SirOp,
  SirProgram,
  ValueRef
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

export type SirFlagLivenessBarrier = Readonly<{
  index: number;
  placement: "before" | "after";
  mask: SirFlagMask;
}>;

export const SIR_FLAG_MASK_NONE = 0;
export const SIR_ARITHMETIC_FLAGS = ["CF", "PF", "AF", "ZF", "SF", "OF"] as const satisfies readonly FlagName[];
export const SIR_FLAG_MASKS = {
  CF: 1 << 0,
  PF: 1 << 1,
  AF: 1 << 2,
  ZF: 1 << 3,
  SF: 1 << 4,
  OF: 1 << 5
} as const satisfies Readonly<Record<FlagName, SirFlagMask>>;
export const SIR_ARITHMETIC_FLAG_MASK = maskSirFlags(SIR_ARITHMETIC_FLAGS);

const noFlagEffect = {
  reads: SIR_FLAG_MASK_NONE,
  writes: SIR_FLAG_MASK_NONE,
  undefines: SIR_FLAG_MASK_NONE
} as const satisfies SirFlagOpEffect;

export function maskSirFlags(flags: Iterable<FlagName>): SirFlagMask {
  let mask = SIR_FLAG_MASK_NONE;

  for (const flag of flags) {
    mask |= SIR_FLAG_MASKS[flag];
  }

  return mask;
}

export function conditionFlagReadMask(cc: ConditionCode): SirFlagMask {
  return maskSirFlags(CONDITIONS[cc].reads);
}

export function flagProducerEffect(producer: FlagProducerName): SirFlagOpEffect {
  const defs = FLAG_PRODUCERS[producer].define(dummyFlagInputs(producer));
  let writes = SIR_FLAG_MASK_NONE;
  let undefines = SIR_FLAG_MASK_NONE;

  for (const flag of SIR_ARITHMETIC_FLAGS) {
    const expr = defs[flag];

    if (expr === undefined) {
      continue;
    }

    writes |= SIR_FLAG_MASKS[flag];

    if (expr.kind === "undefFlag") {
      undefines |= SIR_FLAG_MASKS[flag];
    }
  }

  return { reads: SIR_FLAG_MASK_NONE, writes, undefines };
}

export function sirOpFlagEffect(op: SirOp): SirFlagOpEffect {
  switch (op.op) {
    case "flags.set":
      return flagProducerEffect(op.producer);
    case "condition":
      return {
        reads: conditionFlagReadMask(op.cc),
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
  let live = maskArithmeticFlags(options.liveOut ?? SIR_FLAG_MASK_NONE);

  for (let index = program.length - 1; index >= 0; index -= 1) {
    const effect = effects[index];

    if (effect === undefined) {
      throw new Error(`missing SIR flag effect for op: ${index}`);
    }

    const liveOut = maskArithmeticFlags(live | barriers.after[index]!);
    const killed = effect.writes | effect.undefines;
    const liveIn = maskArithmeticFlags(barriers.before[index]! | effect.reads | (liveOut & ~killed));
    const neededWrites = maskArithmeticFlags(effect.writes & liveOut);
    const deadWrites = maskArithmeticFlags(effect.writes & ~liveOut);

    liveness[index] = { ...effect, liveIn, liveOut, neededWrites, deadWrites };
    live = liveIn;
  }

  return liveness;
}

function flagBarriersByIndex(
  program: SirProgram,
  barriers: readonly SirFlagLivenessBarrier[]
): Readonly<{ before: readonly SirFlagMask[]; after: readonly SirFlagMask[] }> {
  const before = Array.from({ length: program.length }, () => SIR_FLAG_MASK_NONE);
  const after = Array.from({ length: program.length }, () => SIR_FLAG_MASK_NONE);

  for (const barrier of barriers) {
    if (!Number.isInteger(barrier.index) || barrier.index < 0 || barrier.index >= program.length) {
      throw new Error(`SIR flag liveness barrier index out of range: ${barrier.index}`);
    }

    const target = barrier.placement === "before" ? before : after;

    target[barrier.index] = maskArithmeticFlags(target[barrier.index]! | barrier.mask);
  }

  return { before, after };
}

function dummyFlagInputs(producer: FlagProducerName): Readonly<Record<string, ValueRef>> {
  const inputs: Record<string, ValueRef> = {};

  for (const [id, name] of FLAG_PRODUCERS[producer].inputs.entries()) {
    inputs[name] = { kind: "var", id };
  }

  return inputs;
}

function maskArithmeticFlags(mask: SirFlagMask): SirFlagMask {
  return mask & SIR_ARITHMETIC_FLAG_MASK;
}
