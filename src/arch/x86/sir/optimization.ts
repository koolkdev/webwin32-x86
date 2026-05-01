import type { SirProgram } from "./types.js";

export type SirOptimizationResult = Readonly<{
  program: SirProgram;
  opBoundaryMap: readonly number[];
}>;

export type SirOptimizationPass = (program: SirProgram) => SirOptimizationResult;

export function optimizeSirProgram(
  program: SirProgram,
  passes: readonly SirOptimizationPass[]
): SirOptimizationResult {
  let optimizedProgram = program;
  let opBoundaryMap = identitySirOpBoundaryMap(program.length);

  for (const pass of passes) {
    const result = pass(optimizedProgram);

    assertSirOpBoundaryMap(result.opBoundaryMap, optimizedProgram.length, result.program.length);
    opBoundaryMap = composeSirOpBoundaryMaps(opBoundaryMap, result.opBoundaryMap);
    optimizedProgram = result.program;
  }

  return { program: optimizedProgram, opBoundaryMap };
}

export function identitySirOpBoundaryMap(opCount: number): readonly number[] {
  assertOpCount(opCount);

  return Array.from({ length: opCount + 1 }, (_, index) => index);
}

export function composeSirOpBoundaryMaps(
  first: readonly number[],
  second: readonly number[]
): readonly number[] {
  return first.map((boundary) => {
    const mapped = second[boundary];

    if (mapped === undefined) {
      throw new Error(`cannot compose SIR op boundary map at boundary: ${boundary}`);
    }

    return mapped;
  });
}

function assertSirOpBoundaryMap(
  opBoundaryMap: readonly number[],
  inputOpCount: number,
  outputOpCount: number
): void {
  assertOpCount(inputOpCount);
  assertOpCount(outputOpCount);

  if (opBoundaryMap.length !== inputOpCount + 1) {
    throw new Error(
      `SIR op boundary map length ${opBoundaryMap.length} does not match input op count ${inputOpCount}`
    );
  }

  for (let index = 0; index < opBoundaryMap.length; index += 1) {
    const boundary = opBoundaryMap[index];

    if (boundary === undefined || !Number.isInteger(boundary) || boundary < 0 || boundary > outputOpCount) {
      throw new Error(`SIR op boundary map has invalid boundary at ${index}: ${boundary}`);
    }

    if (index > 0 && boundary < opBoundaryMap[index - 1]!) {
      throw new Error(`SIR op boundary map is not monotonic at ${index}: ${boundary}`);
    }
  }

  if (opBoundaryMap[0] !== 0 || opBoundaryMap[inputOpCount] !== outputOpCount) {
    throw new Error("SIR op boundary map endpoints do not match program boundaries");
  }
}

function assertOpCount(opCount: number): void {
  if (!Number.isInteger(opCount) || opCount < 0) {
    throw new Error(`invalid SIR op count: ${opCount}`);
  }
}
