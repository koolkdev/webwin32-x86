import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import type { Mnemonic } from "../src/arch/x86/instruction/mnemonic.js";
import type { Mem32Operand, Operand, Reg32 } from "../src/arch/x86/instruction/types.js";

const startAddress = 0x1000;

const fixtures: readonly MemoryAluFixture[] = [
  {
    name: "add [eax], ebx",
    bytes: [0x01, 0x18],
    mnemonic: "add",
    length: 2,
    operands: [mem32("eax", 0), reg32("ebx")]
  },
  {
    name: "add ebx, [eax]",
    bytes: [0x03, 0x18],
    mnemonic: "add",
    length: 2,
    operands: [reg32("ebx"), mem32("eax", 0)]
  },
  {
    name: "cmp [ebp-4], eax",
    bytes: [0x39, 0x45, 0xfc],
    mnemonic: "cmp",
    length: 3,
    operands: [mem32("ebp", -4), reg32("eax")]
  },
  {
    name: "test [0x00402000], eax",
    bytes: [0x85, 0x05, 0x00, 0x20, 0x40, 0x00],
    mnemonic: "test",
    length: 6,
    operands: [{ kind: "mem32", scale: 1, disp: 0x0040_2000 }, reg32("eax")]
  }
];

for (const fixture of fixtures) {
  test(`decodes ${fixture.name}`, () => {
    const instruction = decodeOne(Uint8Array.from(fixture.bytes), 0, startAddress);

    strictEqual(instruction.address, startAddress);
    strictEqual(instruction.length, fixture.length);
    strictEqual(instruction.mnemonic, fixture.mnemonic);
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

type MemoryAluFixture = Readonly<{
  name: string;
  bytes: readonly number[];
  mnemonic: Extract<Mnemonic, "add" | "cmp" | "test">;
  length: number;
  operands: readonly [Operand, Operand];
}>;
