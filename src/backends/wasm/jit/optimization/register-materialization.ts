import type { Reg32 } from "#x86/isa/types.js";
import type { JitInstructionRewrite } from "./rewrite.js";
import type { JitOptimizationState } from "./state.js";
import { jitTrackedRegisterLocation } from "./tracked-state.js";

export function materializeRegisterValuesForPreInstructionExits(
  rewrite: JitInstructionRewrite,
  instructionIndex: number,
  state: JitOptimizationState
): number {
  return state.tracked.materializeRegistersForPreInstructionExits(rewrite, instructionIndex);
}

export function materializeRegisterValuesForPostInstructionExit(
  rewrite: JitInstructionRewrite,
  instructionIndex: number,
  opIndex: number,
  state: JitOptimizationState
): number {
  return state.tracked.materializeRegistersForPostInstructionExit(rewrite, instructionIndex, opIndex);
}

export function materializeRegisterValuesReadingReg(
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState,
  readReg: Reg32
): number {
  return state.tracked.materializeRequiredLocations(rewrite, {
    kind: "registerDependencies",
    reason: "clobber",
    reg: readReg
  });
}

export function materializeAllRegisterValues(
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState
): number {
  return state.tracked.materializeRequiredLocations(rewrite, {
    kind: "allRegisters",
    reason: "exit"
  });
}

export function materializeRegisterValuesForRead(
  rewrite: JitInstructionRewrite,
  state: JitOptimizationState,
  readRegs: readonly Reg32[]
): number {
  return state.tracked.materializeRequiredLocations(rewrite, {
    kind: "locations",
    reason: "read",
    locations: readRegs.map(jitTrackedRegisterLocation)
  });
}
