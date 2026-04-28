import { testDecoderFixtures, type DecoderFixture } from "../../src/test-support/decoder-fixtures.js";

const fixtures: readonly DecoderFixture[] = [
  {
    name: "jz rel8",
    bytes: [0x74, 0x05],
    mnemonic: "jcc",
    condition: "jz",
    operands: [{ kind: "rel8", displacement: 5, target: 0x1007 }]
  },
  {
    name: "jnz rel8",
    bytes: [0x75, 0xfb],
    mnemonic: "jcc",
    condition: "jnz",
    operands: [{ kind: "rel8", displacement: -5, target: 0x0ffd }]
  },
  {
    name: "jl rel8",
    bytes: [0x7c, 0x80],
    mnemonic: "jcc",
    condition: "jl",
    operands: [{ kind: "rel8", displacement: -128, target: 0x0f82 }]
  }
];

testDecoderFixtures(fixtures);
