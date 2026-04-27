import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import type { Reg32 } from "../src/arch/x86/instruction/types.js";

const startAddress = 0x1000;

const fixtures: readonly RegisterMovFixture[] = [
  {
    bytes: [0x89, 0xd8],
    operands: ["eax", "ebx"]
  },
  {
    bytes: [0x8b, 0xd8],
    operands: ["ebx", "eax"]
  },
  {
    bytes: [0x89, 0xe5],
    operands: ["ebp", "esp"]
  }
];

for (const fixture of fixtures) {
  test(`decodes register mov ${fixture.operands[0]}, ${fixture.operands[1]}`, () => {
    const instruction = decodeOne(Uint8Array.from(fixture.bytes), 0, startAddress);

    strictEqual(instruction.address, startAddress);
    strictEqual(instruction.length, 2);
    strictEqual(instruction.mnemonic, "mov");
    deepStrictEqual(instruction.raw, fixture.bytes);
    deepStrictEqual(instruction.operands[0], { kind: "reg32", reg: fixture.operands[0] });
    deepStrictEqual(instruction.operands[1], { kind: "reg32", reg: fixture.operands[1] });
  });
}

type RegisterMovFixture = Readonly<{
  bytes: readonly number[];
  operands: readonly [Reg32, Reg32];
}>;
