import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import type { Mnemonic } from "../src/arch/x86/instruction/mnemonic.js";
import type { Operand, Reg32 } from "../src/arch/x86/instruction/types.js";

const startAddress = 0x1000;

const fixtures: readonly StackOpcodeFixture[] = [
  {
    name: "push eax",
    bytes: [0x50],
    mnemonic: "push",
    length: 1,
    operands: [reg32("eax")]
  },
  {
    name: "push edi",
    bytes: [0x57],
    mnemonic: "push",
    length: 1,
    operands: [reg32("edi")]
  },
  {
    name: "pop ecx",
    bytes: [0x59],
    mnemonic: "pop",
    length: 1,
    operands: [reg32("ecx")]
  },
  {
    name: "pop edi",
    bytes: [0x5f],
    mnemonic: "pop",
    length: 1,
    operands: [reg32("edi")]
  },
  {
    name: "push imm32",
    bytes: [0x68, 0x44, 0x33, 0x22, 0x11],
    mnemonic: "push",
    length: 5,
    operands: [{ kind: "imm32", value: 0x1122_3344 }]
  },
  {
    name: "push imm8",
    bytes: [0x6a, 0xff],
    mnemonic: "push",
    length: 2,
    operands: [{ kind: "imm8", value: 0xff, signedValue: -1 }],
    executionValue: 0xffff_ffff
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

    if (fixture.executionValue !== undefined) {
      const operand = instruction.operands[0];

      if (operand?.kind !== "imm8") {
        throw new Error("expected imm8 operand");
      }

      strictEqual(operand.signedValue >>> 0, fixture.executionValue);
    }
  });
}

function reg32(reg: Reg32): Operand {
  return { kind: "reg32", reg };
}

type StackOpcodeFixture = Readonly<{
  name: string;
  bytes: readonly number[];
  mnemonic: Extract<Mnemonic, "push" | "pop">;
  length: number;
  operands: readonly Operand[];
  executionValue?: number;
}>;
