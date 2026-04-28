import { testDecoderFixtures, type DecoderFixture } from "../../src/test-support/decoder-fixtures.js";

const fixtures: readonly DecoderFixture[] = [
  {
    name: "jz rel32",
    bytes: [0x0f, 0x84, 0x78, 0x56, 0x34, 0x12],
    mnemonic: "jcc",
    condition: "jz",
    operands: [{ kind: "rel32", displacement: 0x1234_5678, target: 0x1234_667e }]
  },
  {
    name: "jnz rel32",
    bytes: [0x0f, 0x85, 0xfb, 0xff, 0xff, 0xff],
    mnemonic: "jcc",
    condition: "jnz",
    operands: [{ kind: "rel32", displacement: -5, target: 0x1001 }]
  },
  {
    name: "jl rel32",
    bytes: [0x0f, 0x8c, 0x00, 0x00, 0x00, 0x00],
    mnemonic: "jcc",
    condition: "jl",
    operands: [{ kind: "rel32", displacement: 0, target: 0x1006 }]
  }
];

testDecoderFixtures(fixtures);
