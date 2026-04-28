import { testDecoderFixtures, type DecoderFixture } from "../../src/test-support/decoder-fixtures.js";
import { mem32, reg32 } from "../../src/test-support/operands.js";

const fixtures: readonly DecoderFixture[] = [
  {
    name: "add [eax], ebx",
    bytes: [0x01, 0x18],
    mnemonic: "add",
    operands: [mem32({ base: "eax", scale: 1, disp: 0 }), reg32("ebx")]
  },
  {
    name: "add ebx, [eax]",
    bytes: [0x03, 0x18],
    mnemonic: "add",
    operands: [reg32("ebx"), mem32({ base: "eax", scale: 1, disp: 0 })]
  },
  {
    name: "cmp [ebp-4], eax",
    bytes: [0x39, 0x45, 0xfc],
    mnemonic: "cmp",
    operands: [mem32({ base: "ebp", scale: 1, disp: -4 }), reg32("eax")]
  },
  {
    name: "test [0x00402000], eax",
    bytes: [0x85, 0x05, 0x00, 0x20, 0x40, 0x00],
    mnemonic: "test",
    operands: [{ kind: "mem32", scale: 1, disp: 0x0040_2000 }, reg32("eax")]
  }
];

testDecoderFixtures(fixtures);
