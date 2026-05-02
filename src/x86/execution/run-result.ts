import type { CpuState } from "#x86/state/cpu-state.js";

export const StopReason = {
  NONE: 0,
  HOST_TRAP: 4,
  UNSUPPORTED: 5,
  DECODE_FAULT: 6,
  MEMORY_FAULT: 7,
  INSTRUCTION_LIMIT: 8
} as const;

export type StopReason = (typeof StopReason)[keyof typeof StopReason];

export type FaultOperation = "read" | "write" | "execute";

export type UnsupportedReason =
  | "unsupportedOpcode"
  | "unsupportedPrefixSemantics"
  | "unsupportedAddressingMode"
  | "unsupportedInstruction";

export type RunResult = Readonly<{
  stopReason: StopReason;
  finalEip: number;
  instructionCount: number;
  trapVector?: number;
  faultAddress?: number;
  faultSize?: number;
  faultOperation?: FaultOperation;
  unsupportedByte?: number;
  unsupportedReason?: UnsupportedReason;
}>;

export type RunResultDetails = Readonly<
  Omit<RunResult, "stopReason" | "finalEip" | "instructionCount">
>;

export function runResultFromState(
  state: CpuState,
  stopReason: StopReason,
  details: RunResultDetails = {}
): RunResult {
  return {
    stopReason,
    finalEip: state.eip,
    instructionCount: state.instructionCount,
    ...details
  };
}

export function runResultMatchesState(result: RunResult, state: CpuState): boolean {
  return (
    result.finalEip === state.eip &&
    result.instructionCount === state.instructionCount &&
    result.stopReason === state.stopReason
  );
}
