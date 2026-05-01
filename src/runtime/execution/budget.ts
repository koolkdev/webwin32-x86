export type InstructionBudget = Readonly<{
  baseInstructionCount: number;
  instructionLimit: number;
  remaining(currentInstructionCount: number): number;
  exhausted(currentInstructionCount: number): boolean;
}>;

export function createInstructionBudget(
  baseInstructionCount: number,
  instructionLimit: number
): InstructionBudget {
  assertNonNegativeInteger(baseInstructionCount, "baseInstructionCount");
  assertNonNegativeInteger(instructionLimit, "instructionLimit");

  return {
    baseInstructionCount,
    instructionLimit,
    remaining: (currentInstructionCount) =>
      remainingInstructions(baseInstructionCount, instructionLimit, currentInstructionCount),
    exhausted: (currentInstructionCount) =>
      remainingInstructions(baseInstructionCount, instructionLimit, currentInstructionCount) <= 0
  };
}

export function remainingInstructions(
  baseInstructionCount: number,
  instructionLimit: number,
  currentInstructionCount: number
): number {
  assertNonNegativeInteger(currentInstructionCount, "currentInstructionCount");

  const executed = Math.max(0, currentInstructionCount - baseInstructionCount);

  return Math.max(0, instructionLimit - executed);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer: ${value}`);
  }
}
