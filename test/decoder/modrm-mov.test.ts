import { testDecoderFixtures, type DecoderFixture } from "../../src/test-support/decoder-fixtures.js";
import { reg32 } from "../../src/test-support/operands.js";

const fixtures: readonly DecoderFixture[] = [
  {
    name: "register mov eax, ebx",
    bytes: [0x89, 0xd8],
    mnemonic: "mov",
    operands: [reg32("eax"), reg32("ebx")]
  },
  {
    name: "register mov ebx, eax",
    bytes: [0x8b, 0xd8],
    mnemonic: "mov",
    operands: [reg32("ebx"), reg32("eax")]
  },
  {
    name: "register mov ebp, esp",
    bytes: [0x89, 0xe5],
    mnemonic: "mov",
    operands: [reg32("ebp"), reg32("esp")]
  }
];

testDecoderFixtures(fixtures);
