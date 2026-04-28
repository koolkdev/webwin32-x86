import { testDecoderFixtures, type DecoderFixture } from "../../src/test-support/decoder-fixtures.js";
import { reg32 } from "../../src/test-support/operands.js";

const fixtures: readonly DecoderFixture[] = [
  {
    name: "group 83 add eax, imm8",
    bytes: [0x83, 0xc0, 0xff],
    mnemonic: "add",
    operands: [reg32("eax"), { kind: "imm8", value: 0xff, signedValue: -1 }]
  },
  {
    name: "group 83 sub eax, imm8",
    bytes: [0x83, 0xe8, 0x7f],
    mnemonic: "sub",
    operands: [reg32("eax"), { kind: "imm8", value: 0x7f, signedValue: 127 }]
  },
  {
    name: "group 83 cmp ecx, imm8",
    bytes: [0x83, 0xf9, 0x80],
    mnemonic: "cmp",
    operands: [reg32("ecx"), { kind: "imm8", value: 0x80, signedValue: -128 }]
  }
];

testDecoderFixtures(fixtures);
