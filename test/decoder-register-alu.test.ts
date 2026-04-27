import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import type { Mnemonic } from "../src/arch/x86/instruction/mnemonic.js";
import type { Reg32 } from "../src/arch/x86/instruction/types.js";

const startAddress = 0x1000;

const fixtures: readonly RegisterAluFixture[] = [
  {
    bytes: [0x01, 0xd8],
    mnemonic: "add",
    operands: ["eax", "ebx"]
  },
  {
    bytes: [0x03, 0xd8],
    mnemonic: "add",
    operands: ["ebx", "eax"]
  },
  {
    bytes: [0x29, 0xd8],
    mnemonic: "sub",
    operands: ["eax", "ebx"]
  },
  {
    bytes: [0x2b, 0xd8],
    mnemonic: "sub",
    operands: ["ebx", "eax"]
  },
  {
    bytes: [0x31, 0xd8],
    mnemonic: "xor",
    operands: ["eax", "ebx"]
  },
  {
    bytes: [0x33, 0xd8],
    mnemonic: "xor",
    operands: ["ebx", "eax"]
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
  });
}

type RegisterAluFixture = Readonly<{
  bytes: readonly number[];
  mnemonic: Extract<Mnemonic, "add" | "sub" | "xor">;
  operands: readonly [Reg32, Reg32];
}>;
