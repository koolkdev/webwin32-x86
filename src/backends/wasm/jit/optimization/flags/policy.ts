import type { Reg32 } from "#x86/isa/types.js";
import type { JitFlagOwnerMask } from "#backends/wasm/jit/optimization/flags/owners.js";
import type { JitTrackedState } from "#backends/wasm/jit/optimization/tracked/state.js";

export function flagProducerOwnersInvalidatedByRegisterWrite(
  tracked: JitTrackedState,
  reg: Reg32
): readonly JitFlagOwnerMask[] {
  return tracked.flagProducerOwnersReadingReg(reg);
}
