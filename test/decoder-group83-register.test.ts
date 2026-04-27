import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import type { Mnemonic } from "../src/arch/x86/instruction/mnemonic.js";
import type { Reg32 } from "../src/arch/x86/instruction/types.js";

const startAddress = 0x1000;

const fixtures: readonly Group83Fixture[] = [
  {
    bytes: [0x83, 0xc0, 0xff],
    mnemonic: "add",
    reg: "eax",
    value: 0xff,
    signedValue: -1
  },
  {
    bytes: [0x83, 0xe8, 0x7f],
    mnemonic: "sub",
    reg: "eax",
    value: 0x7f,
    signedValue: 127
  },
  {
    bytes: [0x83, 0xf9, 0x80],
    mnemonic: "cmp",
    reg: "ecx",
    value: 0x80,
    signedValue: -128
  }
];

for (const fixture of fixtures) {
  test(`decodes group 83 ${fixture.mnemonic} ${fixture.reg}, imm8`, () => {
    const instruction = decodeOne(Uint8Array.from(fixture.bytes), 0, startAddress);

    strictEqual(instruction.mnemonic, fixture.mnemonic);
    strictEqual(instruction.length, 3);
    deepStrictEqual(instruction.raw, fixture.bytes);
    deepStrictEqual(instruction.operands[0], { kind: "reg32", reg: fixture.reg });
    deepStrictEqual(instruction.operands[1], {
      kind: "imm8",
      value: fixture.value,
      signedValue: fixture.signedValue
    });
  });
}

type Group83Fixture = Readonly<{
  bytes: readonly number[];
  mnemonic: Extract<Mnemonic, "add" | "sub" | "cmp">;
  reg: Reg32;
  value: number;
  signedValue: number;
}>;
