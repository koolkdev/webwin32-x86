import { testDecoderFixtures, type DecoderFixture } from "../../src/test-support/decoder-fixtures.js";
import { mem32, reg32 } from "../../src/test-support/operands.js";

const fixtures: readonly DecoderFixture[] = [
  {
    name: "lea eax, [ebx + ecx*4 + 0x10]",
    bytes: [0x8d, 0x44, 0x8b, 0x10],
    mnemonic: "lea",
    operands: [reg32("eax"), mem32({ base: "ebx", index: "ecx", scale: 4, disp: 0x10 })]
  },
  {
    name: "lea eax, [ecx*4 + 0x00402000]",
    bytes: [0x8d, 0x04, 0x8d, 0x00, 0x20, 0x40, 0x00],
    mnemonic: "lea",
    operands: [reg32("eax"), mem32({ index: "ecx", scale: 4, disp: 0x0040_2000 })]
  }
];

testDecoderFixtures(fixtures);
