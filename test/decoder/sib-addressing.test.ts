import { testDecoderFixtures, type DecoderFixture } from "../../src/test-support/decoder-fixtures.js";
import { mem32, reg32 } from "../../src/test-support/operands.js";

const fixtures: readonly DecoderFixture[] = [
  {
    name: "mov eax, [eax + ecx*4]",
    bytes: [0x8b, 0x04, 0x88],
    mnemonic: "mov",
    operands: [reg32("eax"), mem32({ base: "eax", index: "ecx", scale: 4, disp: 0 })]
  },
  {
    name: "mov eax, [ebx + ecx*4 + 0x10]",
    bytes: [0x8b, 0x44, 0x8b, 0x10],
    mnemonic: "mov",
    operands: [reg32("eax"), mem32({ base: "ebx", index: "ecx", scale: 4, disp: 0x10 })]
  },
  {
    name: "mov eax, [ecx*4 + 0x00402000]",
    bytes: [0x8b, 0x04, 0x8d, 0x00, 0x20, 0x40, 0x00],
    mnemonic: "mov",
    operands: [reg32("eax"), mem32({ index: "ecx", scale: 4, disp: 0x0040_2000 })]
  },
  {
    name: "mov eax, [esp]",
    bytes: [0x8b, 0x04, 0x24],
    mnemonic: "mov",
    operands: [reg32("eax"), mem32({ base: "esp", scale: 1, disp: 0 })]
  },
  {
    name: "mov eax, [esp + 4]",
    bytes: [0x8b, 0x44, 0x24, 0x04],
    mnemonic: "mov",
    operands: [reg32("eax"), mem32({ base: "esp", scale: 1, disp: 4 })]
  },
  {
    name: "mov [esp - 4], ecx",
    bytes: [0x89, 0x4c, 0x24, 0xfc],
    mnemonic: "mov",
    operands: [mem32({ base: "esp", scale: 1, disp: -4 }), reg32("ecx")]
  }
];

testDecoderFixtures(fixtures);
