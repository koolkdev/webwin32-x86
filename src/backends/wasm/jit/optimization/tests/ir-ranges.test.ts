import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import {
  jitIrLocation,
  walkJitIrOpsBetween
} from "#backends/wasm/jit/ir/walk.js";
import {
  findJitRegWritebackBetween,
  jitRegClobberedBetween
} from "#backends/wasm/jit/ir/ranges.js";
import { syntheticInstruction, v } from "./helpers.js";

test("IR range utilities iterate between locations and find register writebacks", () => {
  const block = {
    instructions: [
      syntheticInstruction([
        { op: "const32", dst: v(0), value: 1 },
        { op: "set32", target: { kind: "reg", reg: "eax" }, value: v(0) },
        { op: "next" }
      ]),
      syntheticInstruction([
        { op: "const32", dst: v(0), value: 2 },
        { op: "set32", target: { kind: "reg", reg: "ebx" }, value: v(0) },
        { op: "next" }
      ], 1)
    ]
  };
  const visited: string[] = [];

  walkJitIrOpsBetween(block, jitIrLocation(0, 0), jitIrLocation(1, 1), (_instruction, op, location) => {
    visited.push(`${location.instructionIndex}:${location.opIndex}:${op.op}`);
  });

  deepStrictEqual(visited, ["0:1:set32", "0:2:next", "1:0:const32"]);
  strictEqual(jitRegClobberedBetween(block, "eax", jitIrLocation(0, 0), jitIrLocation(1, 1)), true);
  strictEqual(jitRegClobberedBetween(block, "ecx", jitIrLocation(0, 0), jitIrLocation(1, 1)), false);
  deepStrictEqual(findJitRegWritebackBetween(block, v(0), jitIrLocation(0, 0), jitIrLocation(1, 1)), {
    reg: "eax",
    location: jitIrLocation(0, 1)
  });
});
