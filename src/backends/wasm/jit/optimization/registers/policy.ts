import type { Reg32 } from "#x86/isa/types.js";
import { JitRegisterValues } from "#backends/wasm/jit/optimization/registers/values.js";
import {
  jitValueCost,
  type JitValue
} from "#backends/wasm/jit/ir/values.js";

const maxRepeatedInlineRegisterValueCost = 2;
const maxRetainedRegisterValueCost = 8;

export function shouldRetainRegisterValue(value: JitValue): boolean {
  return jitValueCost(value) <= maxRetainedRegisterValueCost;
}

export function shouldMaterializeRepeatedRegisterRead(
  reg: Reg32,
  value: JitValue,
  registers: JitRegisterValues
): boolean {
  return (
    registers.readCount(reg) > 0 &&
    jitValueCost(value) > maxRepeatedInlineRegisterValueCost
  );
}
