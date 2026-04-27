import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import type { Mnemonic } from "../src/arch/x86/instruction/mnemonic.js";
import type { Reg32 } from "../src/arch/x86/instruction/types.js";

const startAddress = 0x1000;

const fixtures: readonly RegisterCompareFixture[] = [
  {
    bytes: [0x39, 0xd8],
    mnemonic: "cmp",
    operands: ["eax", "ebx"]
  },
  {
    bytes: [0x3b, 0xd8],
    mnemonic: "cmp",
    operands: ["ebx", "eax"]
  },
  {
    bytes: [0x85, 0xd8],
    mnemonic: "test",
    operands: ["eax", "ebx"]
  }
];

for (const fixture of fixtures) {
  test(`decodes ${fixture.mnemonic} ${fixture.operands[0]}, ${fixture.operands[1]}`, () => {
    const instruction = decodeOne(Uint8Array.from(fixture.bytes), 0, startAddress);

    strictEqual(instruction.mnemonic, fixture.mnemonic);
    strictEqual(instruction.length, 2);
    deepStrictEqual(instruction.raw, fixture.bytes);
    deepStrictEqual(instruction.operands[0], { kind: "reg32", reg: fixture.operands[0] });
    deepStrictEqual(instruction.operands[1], { kind: "reg32", reg: fixture.operands[1] });
    strictEqual("destination" in instruction.operands[0], false);
  });
}

type RegisterCompareFixture = Readonly<{
  bytes: readonly number[];
  mnemonic: Extract<Mnemonic, "cmp" | "test">;
  operands: readonly [Reg32, Reg32];
}>;
