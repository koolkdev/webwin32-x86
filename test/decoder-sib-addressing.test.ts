import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import type { Mem32Operand, Operand, Reg32 } from "../src/arch/x86/instruction/types.js";

const startAddress = 0x1000;

const fixtures: readonly SibFixture[] = [
  {
    name: "mov eax, [eax + ecx*4]",
    bytes: [0x8b, 0x04, 0x88],
    length: 3,
    operands: [reg32("eax"), mem32({ base: "eax", index: "ecx", scale: 4, disp: 0 })]
  },
  {
    name: "mov eax, [ebx + ecx*4 + 0x10]",
    bytes: [0x8b, 0x44, 0x8b, 0x10],
    length: 4,
    operands: [reg32("eax"), mem32({ base: "ebx", index: "ecx", scale: 4, disp: 0x10 })]
  },
  {
    name: "mov eax, [ecx*4 + 0x00402000]",
    bytes: [0x8b, 0x04, 0x8d, 0x00, 0x20, 0x40, 0x00],
    length: 7,
    operands: [reg32("eax"), mem32({ index: "ecx", scale: 4, disp: 0x0040_2000 })]
  },
  {
    name: "mov eax, [esp]",
    bytes: [0x8b, 0x04, 0x24],
    length: 3,
    operands: [reg32("eax"), mem32({ base: "esp", scale: 1, disp: 0 })]
  },
  {
    name: "mov eax, [esp + 4]",
    bytes: [0x8b, 0x44, 0x24, 0x04],
    length: 4,
    operands: [reg32("eax"), mem32({ base: "esp", scale: 1, disp: 4 })]
  },
  {
    name: "mov [esp - 4], ecx",
    bytes: [0x89, 0x4c, 0x24, 0xfc],
    length: 4,
    operands: [mem32({ base: "esp", scale: 1, disp: -4 }), reg32("ecx")]
  }
];

for (const fixture of fixtures) {
  test(`decodes ${fixture.name}`, () => {
    const instruction = decodeOne(Uint8Array.from(fixture.bytes), 0, startAddress);

    strictEqual(instruction.address, startAddress);
    strictEqual(instruction.length, fixture.length);
    strictEqual(instruction.mnemonic, "mov");
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

type SibFixture = Readonly<{
  name: string;
  bytes: readonly number[];
  length: number;
  operands: readonly [Operand, Operand];
}>;
