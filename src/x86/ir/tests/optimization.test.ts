import { deepStrictEqual } from "node:assert";
import { test } from "node:test";

import { optimizeIrBlock } from "#x86/ir/passes/optimization.js";
import type { IrBlockOptimizationPass } from "#x86/ir/passes/optimization.js";
import type { IrBlock } from "#x86/ir/model/types.js";

const program = [
  { op: "get32", dst: { kind: "var", id: 0 }, source: { kind: "reg", reg: "eax" } },
  { op: "get32", dst: { kind: "var", id: 1 }, source: { kind: "reg", reg: "ebx" } },
  { op: "set32", target: { kind: "reg", reg: "ecx" }, value: { kind: "var", id: 0 } },
  { op: "next" }
] as const satisfies IrBlock;

test("IR optimization pipeline applies passes in order", () => {
  const removeSecondOp: IrBlockOptimizationPass = (input) => ({
    block: [input[0]!, input[2]!, input[3]!]
  });
  const removeNewSecondOp: IrBlockOptimizationPass = (input) => ({
    block: [input[0]!, input[2]!]
  });

  deepStrictEqual(optimizeIrBlock(program, [removeSecondOp, removeNewSecondOp]), {
    block: [program[0], program[3]]
  });
});
