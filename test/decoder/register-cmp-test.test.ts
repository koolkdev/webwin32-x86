import { testDecoderFixtures, type DecoderFixture } from "../../src/test-support/decoder-fixtures.js";
import { reg32 } from "../../src/test-support/operands.js";

const fixtures: readonly DecoderFixture[] = [
  {
    name: "cmp eax, ebx",
    bytes: [0x39, 0xd8],
    mnemonic: "cmp",
    operands: [reg32("eax"), reg32("ebx")]
  },
  {
    name: "cmp ebx, eax",
    bytes: [0x3b, 0xd8],
    mnemonic: "cmp",
    operands: [reg32("ebx"), reg32("eax")]
  },
  {
    name: "test eax, ebx",
    bytes: [0x85, 0xd8],
    mnemonic: "test",
    operands: [reg32("eax"), reg32("ebx")]
  }
];

testDecoderFixtures(fixtures);
