import { testDecoderFixtures } from "../../src/test-support/decoder-fixtures.js";

testDecoderFixtures([
  {
    name: "call rel32",
    bytes: [0xe8, 0x05, 0x00, 0x00, 0x00],
    mnemonic: "call",
    operands: [{ kind: "rel32", displacement: 5, target: 0x100a }]
  },
  {
    name: "ret",
    bytes: [0xc3],
    mnemonic: "ret"
  },
  {
    name: "ret imm16",
    bytes: [0xc2, 0x08, 0x00],
    mnemonic: "ret",
    operands: [{ kind: "imm16", value: 8 }]
  }
]);
