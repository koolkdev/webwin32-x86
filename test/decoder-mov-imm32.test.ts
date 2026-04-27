import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decode-one.js";
import type { Reg32 } from "../src/arch/x86/instruction/types.js";

const startAddress = 0x1000;

const fixtures: readonly MovImm32Fixture[] = [
  {
    bytes: [0xb8, 0x78, 0x56, 0x34, 0x12],
    reg: "eax",
    value: 0x1234_5678
  },
  {
    bytes: [0xb9, 0x01, 0x00, 0x00, 0x00],
    reg: "ecx",
    value: 0x0000_0001
  },
  {
    bytes: [0xbf, 0xff, 0xff, 0xff, 0xff],
    reg: "edi",
    value: 0xffff_ffff
  }
];

for (const fixture of fixtures) {
  test(`decodes mov ${fixture.reg}, imm32`, () => {
    const instruction = decodeOne(Uint8Array.from(fixture.bytes), 0, startAddress);

    strictEqual(instruction.address, startAddress);
    strictEqual(instruction.length, 5);
    strictEqual(0 + instruction.length, 5);
    strictEqual(instruction.mnemonic, "mov");
    deepStrictEqual(instruction.raw, fixture.bytes);
    deepStrictEqual(instruction.operands[0], { kind: "reg32", reg: fixture.reg });
    deepStrictEqual(instruction.operands[1], { kind: "imm32", value: fixture.value });
  });
}

type MovImm32Fixture = Readonly<{
  bytes: readonly number[];
  reg: Reg32;
  value: number;
}>;
