import { testDecoderFixtures, type DecoderFixture } from "../../src/test-support/decoder-fixtures.js";
import { mem32, reg32 } from "../../src/test-support/operands.js";

const fixtures: readonly DecoderFixture[] = [
  {
    name: "mov eax, [ebx]",
    bytes: [0x8b, 0x03],
    mnemonic: "mov",
    operands: [reg32("eax"), mem32({ base: "ebx", scale: 1, disp: 0 })]
  },
  {
    name: "mov eax, [ebx+4]",
    bytes: [0x8b, 0x43, 0x04],
    mnemonic: "mov",
    operands: [reg32("eax"), mem32({ base: "ebx", scale: 1, disp: 4 })]
  },
  {
    name: "mov eax, [ebx+0x12345678]",
    bytes: [0x8b, 0x83, 0x78, 0x56, 0x34, 0x12],
    mnemonic: "mov",
    operands: [reg32("eax"), mem32({ base: "ebx", scale: 1, disp: 0x1234_5678 })]
  },
  {
    name: "mov eax, [0x00402000]",
    bytes: [0x8b, 0x05, 0x00, 0x20, 0x40, 0x00],
    mnemonic: "mov",
    operands: [reg32("eax"), { kind: "mem32", scale: 1, disp: 0x0040_2000 }]
  },
  {
    name: "mov [ebp-4], eax",
    bytes: [0x89, 0x45, 0xfc],
    mnemonic: "mov",
    operands: [mem32({ base: "ebp", scale: 1, disp: -4 }), reg32("eax")]
  }
];

testDecoderFixtures(fixtures);
