import { deepStrictEqual } from "node:assert";
import { test } from "node:test";

import {
  composeSirOpBoundaryMaps,
  identitySirOpBoundaryMap,
  optimizeSirProgram
} from "../optimization.js";
import type { SirOptimizationPass } from "../optimization.js";
import type { SirProgram } from "../types.js";

const program = [
  { op: "get32", dst: { kind: "var", id: 0 }, source: { kind: "reg", reg: "eax" } },
  { op: "get32", dst: { kind: "var", id: 1 }, source: { kind: "reg", reg: "ebx" } },
  { op: "set32", target: { kind: "reg", reg: "ecx" }, value: { kind: "var", id: 0 } },
  { op: "next" }
] as const satisfies SirProgram;

test("SIR optimization pipeline composes op boundary maps across passes", () => {
  const removeSecondOp: SirOptimizationPass = (input) => ({
    program: [input[0]!, input[2]!, input[3]!],
    opBoundaryMap: [0, 1, 1, 2, 3]
  });
  const removeNewSecondOp: SirOptimizationPass = (input) => ({
    program: [input[0]!, input[2]!],
    opBoundaryMap: [0, 1, 1, 2]
  });

  deepStrictEqual(optimizeSirProgram(program, [removeSecondOp, removeNewSecondOp]), {
    program: [program[0], program[3]],
    opBoundaryMap: [0, 1, 1, 1, 2]
  });
});

test("SIR op boundary map helpers keep identity and composition explicit", () => {
  deepStrictEqual(identitySirOpBoundaryMap(3), [0, 1, 2, 3]);
  deepStrictEqual(composeSirOpBoundaryMaps([0, 1, 1, 2, 3], [0, 0, 1, 2]), [0, 0, 0, 1, 2]);
});
