import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import type { Mnemonic } from "../src/arch/x86/instruction/mnemonic.js";
import type { Reg32 } from "../src/arch/x86/instruction/types.js";

const startAddress = 0x1000;

const fixtures: readonly Group81Fixture[] = [
  {
    bytes: [0x81, 0xc0, 0x78, 0x56, 0x34, 0x12],
    mnemonic: "add",
    reg: "eax",
    value: 0x1234_5678
  },
  {
    bytes: [0x81, 0xe8, 0x01, 0x00, 0x00, 0x00],
    mnemonic: "sub",
    reg: "eax",
    value: 1
  },
  {
    bytes: [0x81, 0xf9, 0x00, 0x00, 0x00, 0x00],
    mnemonic: "cmp",
    reg: "ecx",
    value: 0
  }
];

for (const fixture of fixtures) {
  test(`decodes group 81 ${fixture.mnemonic} ${fixture.reg}, imm32`, () => {
    const instruction = decodeOne(Uint8Array.from(fixture.bytes), 0, startAddress);

    strictEqual(instruction.mnemonic, fixture.mnemonic);
    strictEqual(instruction.length, 6);
    deepStrictEqual(instruction.raw, fixture.bytes);
    deepStrictEqual(instruction.operands[0], { kind: "reg32", reg: fixture.reg });
    deepStrictEqual(instruction.operands[1], { kind: "imm32", value: fixture.value });
  });
}

type Group81Fixture = Readonly<{
  bytes: readonly number[];
  mnemonic: Extract<Mnemonic, "add" | "sub" | "cmp">;
  reg: Reg32;
  value: number;
}>;
