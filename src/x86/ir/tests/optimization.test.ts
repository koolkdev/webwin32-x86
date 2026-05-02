import { deepStrictEqual } from "node:assert";
import { test } from "node:test";

import { optimizeIrProgram } from "../passes/optimization.js";
import type { IrOptimizationPass } from "../passes/optimization.js";
import type { IrProgram } from "../model/types.js";

const program = [
  { op: "get32", dst: { kind: "var", id: 0 }, source: { kind: "reg", reg: "eax" } },
  { op: "get32", dst: { kind: "var", id: 1 }, source: { kind: "reg", reg: "ebx" } },
  { op: "set32", target: { kind: "reg", reg: "ecx" }, value: { kind: "var", id: 0 } },
  { op: "next" }
] as const satisfies IrProgram;

test("IR optimization pipeline applies passes in order", () => {
  const removeSecondOp: IrOptimizationPass = (input) => ({
    program: [input[0]!, input[2]!, input[3]!]
  });
  const removeNewSecondOp: IrOptimizationPass = (input) => ({
    program: [input[0]!, input[2]!]
  });

  deepStrictEqual(optimizeIrProgram(program, [removeSecondOp, removeNewSecondOp]), {
    program: [program[0], program[3]]
  });
});
