import type { Reg32 } from "#x86/isa/types.js";
import type { JitDirectFlagCondition } from "#backends/wasm/jit/optimization/flags/conditions.js";
import type { JitFlagOwnerMask } from "#backends/wasm/jit/optimization/flags/owners.js";
import type { JitFlagRead, JitFlagSource } from "#backends/wasm/jit/optimization/flags/analysis.js";
import type { JitTrackedState } from "#backends/wasm/jit/optimization/tracked/state.js";

export function flagProducerOwnersInvalidatedByRegisterWrite(
  tracked: JitTrackedState,
  reg: Reg32
): readonly JitFlagOwnerMask[] {
  return tracked.flagProducerOwnersReadingReg(reg);
}

export function canFoldFlagReadAsDirectCondition(
  read: JitFlagRead,
  directCondition: JitDirectFlagCondition | undefined
): boolean {
  return read.reason === "condition" && directCondition !== undefined;
}

export function shouldMaterializeFlagRead(
  read: JitFlagRead,
  directCondition: JitDirectFlagCondition | undefined
): boolean {
  return read.requiredMask !== 0 && !canFoldFlagReadAsDirectCondition(read, directCondition);
}

export function shouldDropFlagProducer(
  source: JitFlagSource,
  neededSourceIds: ReadonlySet<number>
): boolean {
  return !neededSourceIds.has(source.id);
}
