import { testDecoderFixtures, type DecoderFixture } from "../../src/test-support/decoder-fixtures.js";
import { reg32 } from "../../src/test-support/operands.js";

const fixtures: readonly DecoderFixture[] = [
  {
    name: "mov eax, imm32",
    bytes: [0xb8, 0x78, 0x56, 0x34, 0x12],
    mnemonic: "mov",
    operands: [reg32("eax"), { kind: "imm32", value: 0x1234_5678 }]
  },
  {
    name: "mov ecx, imm32",
    bytes: [0xb9, 0x01, 0x00, 0x00, 0x00],
    mnemonic: "mov",
    operands: [reg32("ecx"), { kind: "imm32", value: 0x0000_0001 }]
  },
  {
    name: "mov edi, imm32",
    bytes: [0xbf, 0xff, 0xff, 0xff, 0xff],
    mnemonic: "mov",
    operands: [reg32("edi"), { kind: "imm32", value: 0xffff_ffff }]
  }
];

testDecoderFixtures(fixtures);
