import { testDecoderFixtures, type DecoderFixture } from "../../src/test-support/decoder-fixtures.js";

const fixtures: readonly DecoderFixture[] = [
  {
    name: "jmp rel8 5",
    bytes: [0xeb, 0x05],
    mnemonic: "jmp",
    operands: [{ kind: "rel8", displacement: 5, target: 0x1007 }]
  },
  {
    name: "jmp rel8 -2",
    bytes: [0xeb, 0xfe],
    mnemonic: "jmp",
    operands: [{ kind: "rel8", displacement: -2, target: 0x1000 }]
  },
  {
    name: "jmp rel32 -5",
    bytes: [0xe9, 0xfb, 0xff, 0xff, 0xff],
    mnemonic: "jmp",
    operands: [{ kind: "rel32", displacement: -5, target: 0x1000 }]
  }
];

testDecoderFixtures(fixtures);
