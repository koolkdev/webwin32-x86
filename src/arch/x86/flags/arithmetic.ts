import { hasEvenParityLowByte, setFlag, type CpuState, u32 } from "../../../core/state/cpu-state.js";

export function applyAddFlags(state: CpuState, left: number, right: number, result: number): void {
  const leftU32 = u32(left);
  const rightU32 = u32(right);
  const resultU32 = u32(result);

  setFlag(state, "CF", leftU32 + rightU32 > 0xffff_ffff);
  setFlag(state, "PF", hasEvenParityLowByte(resultU32));
  setFlag(state, "AF", ((leftU32 ^ rightU32 ^ resultU32) & 0x10) !== 0);
  setFlag(state, "ZF", resultU32 === 0);
  setFlag(state, "SF", (resultU32 & 0x8000_0000) !== 0);
  setFlag(state, "OF", ((~(leftU32 ^ rightU32) & (leftU32 ^ resultU32)) & 0x8000_0000) !== 0);
}

export function applySubFlags(state: CpuState, left: number, right: number, result: number): void {
  const leftU32 = u32(left);
  const rightU32 = u32(right);
  const resultU32 = u32(result);

  setFlag(state, "CF", leftU32 < rightU32);
  setFlag(state, "PF", hasEvenParityLowByte(resultU32));
  setFlag(state, "AF", ((leftU32 ^ rightU32 ^ resultU32) & 0x10) !== 0);
  setFlag(state, "ZF", resultU32 === 0);
  setFlag(state, "SF", (resultU32 & 0x8000_0000) !== 0);
  setFlag(state, "OF", (((leftU32 ^ rightU32) & (leftU32 ^ resultU32)) & 0x8000_0000) !== 0);
}
