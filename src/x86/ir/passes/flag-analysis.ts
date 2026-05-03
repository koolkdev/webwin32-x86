import type { IrBlock } from "#x86/ir/model/types.js";
import {
  analyzeIrFlagEffects,
  assertIrAluFlagMask,
  IR_FLAG_MASK_NONE,
  irIndexedFlagPointMasks,
  type IrFlagMask,
  type IrFlagOpEffect,
  type IrIndexedFlagPoint,
  type IrIndexedFlagPointMasks
} from "#x86/ir/model/flag-effects.js";

export {
  analyzeIrFlagEffects,
  assertIrAluFlagMask,
  conditionFlagReadMask,
  flagProducerEffect,
  IR_ALU_FLAG_MASK,
  IR_ALU_FLAG_MASKS,
  IR_ALU_FLAGS,
  IR_FLAG_MASK_NONE,
  irIndexedFlagPointMasks,
  irOpFlagEffect,
  maskIrAluFlags
} from "#x86/ir/model/flag-effects.js";
export type {
  IrFlagMask,
  IrFlagOpEffect,
  IrIndexedFlagPoint,
  IrIndexedFlagPointMasks
} from "#x86/ir/model/flag-effects.js";

export type IrFlagOpLiveness = IrFlagOpEffect &
  Readonly<{
    liveIn: IrFlagMask;
    liveOut: IrFlagMask;
    neededWrites: IrFlagMask;
    deadWrites: IrFlagMask;
  }>;

export type IrFlagLivenessOptions = Readonly<{
  liveOut?: IrFlagMask;
  barriers?: readonly IrFlagLivenessBarrier[];
}>;

export type IrFlagLivenessBarrier = IrIndexedFlagPoint;

export function analyzeIrFlagLiveness(
  block: IrBlock,
  options: IrFlagLivenessOptions = {}
): readonly IrFlagOpLiveness[] {
  const effects = analyzeIrFlagEffects(block);
  const barriers = flagBarriersByIndex(block, options.barriers ?? []);
  const liveness: IrFlagOpLiveness[] = new Array(block.length);
  const liveOutOption = options.liveOut ?? IR_FLAG_MASK_NONE;

  assertIrAluFlagMask(liveOutOption, "IR flag liveness liveOut");

  let live = liveOutOption;

  for (let index = block.length - 1; index >= 0; index -= 1) {
    const effect = effects[index];

    if (effect === undefined) {
      throw new Error(`missing IR flag effect for op: ${index}`);
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
  block: IrBlock,
  barriers: readonly IrFlagLivenessBarrier[]
): IrIndexedFlagPointMasks {
  return irIndexedFlagPointMasks(block, barriers, "IR flag liveness barrier");
}
