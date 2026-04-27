import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import type { Mem32Operand, Operand, Reg32 } from "../src/arch/x86/instruction/types.js";

const startAddress = 0x1000;

const fixtures: readonly MovMemoryFixture[] = [
  {
    name: "mov eax, [ebx]",
    bytes: [0x8b, 0x03],
    length: 2,
    operands: [reg32("eax"), mem32("ebx", 0)]
  },
  {
    name: "mov eax, [ebx+4]",
    bytes: [0x8b, 0x43, 0x04],
    length: 3,
    operands: [reg32("eax"), mem32("ebx", 4)]
  },
  {
    name: "mov eax, [ebx+0x12345678]",
    bytes: [0x8b, 0x83, 0x78, 0x56, 0x34, 0x12],
    length: 6,
    operands: [reg32("eax"), mem32("ebx", 0x1234_5678)]
  },
  {
    name: "mov eax, [0x00402000]",
    bytes: [0x8b, 0x05, 0x00, 0x20, 0x40, 0x00],
    length: 6,
    operands: [reg32("eax"), { kind: "mem32", scale: 1, disp: 0x0040_2000 }]
  },
  {
    name: "mov [ebp-4], eax",
    bytes: [0x89, 0x45, 0xfc],
    length: 3,
    operands: [mem32("ebp", -4), reg32("eax")]
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

function mem32(base: Reg32, disp: number): Mem32Operand {
  return { kind: "mem32", base, scale: 1, disp };
}

type MovMemoryFixture = Readonly<{
  name: string;
  bytes: readonly number[];
  length: number;
  operands: readonly [Operand, Operand];
}>;
