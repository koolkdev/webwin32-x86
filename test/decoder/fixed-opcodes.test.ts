import { testDecoderFixtures } from "../../src/test-support/decoder-fixtures.js";

testDecoderFixtures([
  {
    name: "nop",
    bytes: [0x90],
    mnemonic: "nop"
  },
  {
    name: "int imm8",
    bytes: [0xcd, 0x2e],
    mnemonic: "int",
    operands: [{ kind: "imm8", value: 0x2e, signedValue: 46 }]
  },
  {
    name: "unsupported opcode without throwing",
    bytes: [0x62],
    mnemonic: "unsupported"
  }
]);
