import { hasEvenParityLowByte, u32 } from "../../../core/state/cpu-state.js";

export type FlagValues = Readonly<{
  CF: boolean;
  PF: boolean;
  AF: boolean;
  ZF: boolean;
  SF: boolean;
  OF: boolean;
}>;

export function addFlags(left: number, right: number, result: number): FlagValues {
  const leftU32 = u32(left);
  const rightU32 = u32(right);
  const resultU32 = u32(result);

  return resultFlags(resultU32, {
    CF: leftU32 + rightU32 > 0xffff_ffff,
    AF: ((leftU32 ^ rightU32 ^ resultU32) & 0x10) !== 0,
    OF: ((~(leftU32 ^ rightU32) & (leftU32 ^ resultU32)) & 0x8000_0000) !== 0
  });
}

export function subFlags(left: number, right: number, result: number): FlagValues {
  const leftU32 = u32(left);
  const rightU32 = u32(right);
  const resultU32 = u32(result);

  return resultFlags(resultU32, {
    CF: leftU32 < rightU32,
    AF: ((leftU32 ^ rightU32 ^ resultU32) & 0x10) !== 0,
    OF: (((leftU32 ^ rightU32) & (leftU32 ^ resultU32)) & 0x8000_0000) !== 0
  });
}

export function logicalFlags(result: number): FlagValues {
  const resultU32 = u32(result);

  return resultFlags(resultU32, {
    CF: false,
    AF: false,
    OF: false
  });
}

function resultFlags(
  result: number,
  flags: Readonly<{
    CF: boolean;
    AF: boolean;
    OF: boolean;
  }>
): FlagValues {
  return {
    CF: flags.CF,
    PF: hasEvenParityLowByte(result),
    AF: flags.AF,
    ZF: result === 0,
    SF: (result & 0x8000_0000) !== 0,
    OF: flags.OF
  };
}
