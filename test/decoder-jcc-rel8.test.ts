import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import type { JccCondition } from "../src/arch/x86/instruction/condition.js";

const startAddress = 0x1000;

const fixtures: readonly JccRel8Fixture[] = [
  {
    bytes: [0x74, 0x05],
    condition: "jz",
    displacement: 5,
    target: 0x1007
  },
  {
    bytes: [0x75, 0xfb],
    condition: "jnz",
    displacement: -5,
    target: 0x0ffd
  },
  {
    bytes: [0x7c, 0x80],
    condition: "jl",
    displacement: -128,
    target: 0x0f82
  }
];

for (const fixture of fixtures) {
  test(`decodes ${fixture.condition} rel8`, () => {
    const instruction = decodeOne(Uint8Array.from(fixture.bytes), 0, startAddress);

    strictEqual(instruction.mnemonic, "jcc");
    strictEqual(instruction.condition, fixture.condition);
    strictEqual(instruction.length, 2);
    deepStrictEqual(instruction.operands[0], {
      kind: "rel8",
      displacement: fixture.displacement,
      target: fixture.target
    });
  });
}

type JccRel8Fixture = Readonly<{
  bytes: readonly number[];
  condition: JccCondition;
  displacement: number;
  target: number;
}>;
