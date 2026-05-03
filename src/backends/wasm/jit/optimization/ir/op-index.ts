export type JitOpIndex<T> = ReadonlyMap<number, ReadonlyMap<number, T>>;

export function setJitOpIndexValue<T>(
  index: Map<number, Map<number, T>>,
  instructionIndex: number,
  opIndex: number,
  value: T
): void {
  let instructionValues = index.get(instructionIndex);

  if (instructionValues === undefined) {
    instructionValues = new Map();
    index.set(instructionIndex, instructionValues);
  }

  instructionValues.set(opIndex, value);
}
