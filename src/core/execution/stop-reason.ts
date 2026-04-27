export const StopReason = {
  NONE: 0,
  HOST_TRAP: 4,
  UNSUPPORTED: 6,
  INSTRUCTION_LIMIT: 9
} as const;

export type StopReason = (typeof StopReason)[keyof typeof StopReason];

export type InstructionResult = Readonly<{
  stopReason: StopReason;
  eip: number;
  trapVector?: number;
}>;
