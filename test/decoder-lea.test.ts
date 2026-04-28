import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import type { Mem32Operand, Operand, Reg32 } from "../src/arch/x86/instruction/types.js";

const startAddress = 0x1000;

const fixtures: readonly LeaFixture[] = [
  {
    name: "lea eax, [ebx + ecx*4 + 0x10]",
    bytes: [0x8d, 0x44, 0x8b, 0x10],
    length: 4,
    operands: [reg32("eax"), mem32({ base: "ebx", index: "ecx", scale: 4, disp: 0x10 })]
  },
  {
    name: "lea eax, [ecx*4 + 0x00402000]",
    bytes: [0x8d, 0x04, 0x8d, 0x00, 0x20, 0x40, 0x00],
    length: 7,
    operands: [reg32("eax"), mem32({ index: "ecx", scale: 4, disp: 0x0040_2000 })]
  }
];

for (const fixture of fixtures) {
  test(`decodes ${fixture.name}`, () => {
    const instruction = decodeOne(Uint8Array.from(fixture.bytes), 0, startAddress);

    strictEqual(instruction.address, startAddress);
    strictEqual(instruction.length, fixture.length);
    strictEqual(instruction.mnemonic, "lea");
    deepStrictEqual(instruction.raw, fixture.bytes);
    deepStrictEqual(instruction.operands, fixture.operands);
  });
}

function reg32(reg: Reg32): Operand {
  return { kind: "reg32", reg };
}

function mem32(operand: Omit<Mem32Operand, "kind">): Mem32Operand {
  return { kind: "mem32", ...operand };
}

type LeaFixture = Readonly<{
  name: string;
  bytes: readonly number[];
  length: number;
  operands: readonly [Operand, Operand];
}>;
