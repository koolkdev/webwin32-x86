import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import type { JccCondition } from "../src/arch/x86/instruction/condition.js";

const startAddress = 0x1000;

const fixtures: readonly JccRel32Fixture[] = [
  {
    bytes: [0x0f, 0x84, 0x78, 0x56, 0x34, 0x12],
    condition: "jz",
    displacement: 0x1234_5678,
    target: 0x1234_667e
  },
  {
    bytes: [0x0f, 0x85, 0xfb, 0xff, 0xff, 0xff],
    condition: "jnz",
    displacement: -5,
    target: 0x1001
  },
  {
    bytes: [0x0f, 0x8c, 0x00, 0x00, 0x00, 0x00],
    condition: "jl",
    displacement: 0,
    target: 0x1006
  }
];

for (const fixture of fixtures) {
  test(`decodes ${fixture.condition} rel32`, () => {
    const instruction = decodeOne(Uint8Array.from(fixture.bytes), 0, startAddress);

    strictEqual(instruction.mnemonic, "jcc");
    strictEqual(instruction.condition, fixture.condition);
    strictEqual(instruction.length, 6);
    deepStrictEqual(instruction.operands[0], {
      kind: "rel32",
      displacement: fixture.displacement,
      target: fixture.target
    });
  });
}

type JccRel32Fixture = Readonly<{
  bytes: readonly number[];
  condition: JccCondition;
  displacement: number;
  target: number;
}>;
