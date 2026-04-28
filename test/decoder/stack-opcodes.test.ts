import { testDecoderFixtures, type DecoderFixture } from "../../src/test-support/decoder-fixtures.js";
import { reg32 } from "../../src/test-support/operands.js";

const fixtures: readonly DecoderFixture[] = [
  {
    name: "push eax",
    bytes: [0x50],
    mnemonic: "push",
    operands: [reg32("eax")]
  },
  {
    name: "push edi",
    bytes: [0x57],
    mnemonic: "push",
    operands: [reg32("edi")]
  },
  {
    name: "pop ecx",
    bytes: [0x59],
    mnemonic: "pop",
    operands: [reg32("ecx")]
  },
  {
    name: "pop edi",
    bytes: [0x5f],
    mnemonic: "pop",
    operands: [reg32("edi")]
  },
  {
    name: "push imm32",
    bytes: [0x68, 0x44, 0x33, 0x22, 0x11],
    mnemonic: "push",
    operands: [{ kind: "imm32", value: 0x1122_3344 }]
  },
  {
    name: "push imm8",
    bytes: [0x6a, 0xff],
    mnemonic: "push",
    operands: [{ kind: "imm8", value: 0xff, signedValue: -1 }]
  }
];

testDecoderFixtures(fixtures);
