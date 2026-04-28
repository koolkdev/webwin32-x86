import { testDecoderFixtures, type DecoderFixture } from "../../src/test-support/decoder-fixtures.js";
import { reg32 } from "../../src/test-support/operands.js";

const fixtures: readonly DecoderFixture[] = [
  {
    name: "add eax, ebx",
    bytes: [0x01, 0xd8],
    mnemonic: "add",
    operands: [reg32("eax"), reg32("ebx")]
  },
  {
    name: "add ebx, eax",
    bytes: [0x03, 0xd8],
    mnemonic: "add",
    operands: [reg32("ebx"), reg32("eax")]
  },
  {
    name: "sub eax, ebx",
    bytes: [0x29, 0xd8],
    mnemonic: "sub",
    operands: [reg32("eax"), reg32("ebx")]
  },
  {
    name: "sub ebx, eax",
    bytes: [0x2b, 0xd8],
    mnemonic: "sub",
    operands: [reg32("ebx"), reg32("eax")]
  },
  {
    name: "xor eax, ebx",
    bytes: [0x31, 0xd8],
    mnemonic: "xor",
    operands: [reg32("eax"), reg32("ebx")]
  },
  {
    name: "xor ebx, eax",
    bytes: [0x33, 0xd8],
    mnemonic: "xor",
    operands: [reg32("ebx"), reg32("eax")]
  }
];

testDecoderFixtures(fixtures);
