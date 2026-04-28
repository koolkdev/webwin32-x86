import { testDecoderFixtures, type DecoderFixture } from "../../src/test-support/decoder-fixtures.js";
import { reg32 } from "../../src/test-support/operands.js";

const fixtures: readonly DecoderFixture[] = [
  {
    name: "group 81 add eax, imm32",
    bytes: [0x81, 0xc0, 0x78, 0x56, 0x34, 0x12],
    mnemonic: "add",
    operands: [reg32("eax"), { kind: "imm32", value: 0x1234_5678 }]
  },
  {
    name: "group 81 sub eax, imm32",
    bytes: [0x81, 0xe8, 0x01, 0x00, 0x00, 0x00],
    mnemonic: "sub",
    operands: [reg32("eax"), { kind: "imm32", value: 1 }]
  },
  {
    name: "group 81 cmp ecx, imm32",
    bytes: [0x81, 0xf9, 0x00, 0x00, 0x00, 0x00],
    mnemonic: "cmp",
    operands: [reg32("ecx"), { kind: "imm32", value: 0 }]
  }
];

testDecoderFixtures(fixtures);
