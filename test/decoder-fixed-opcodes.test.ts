import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";

const startAddress = 0x1000;

test("decodes nop", () => {
  const instruction = decodeOne(Uint8Array.from([0x90]), 0, startAddress);

  strictEqual(instruction.address, startAddress);
  strictEqual(instruction.length, 1);
  strictEqual(0 + instruction.length, 1);
  strictEqual(instruction.mnemonic, "nop");
  deepStrictEqual(instruction.raw, [0x90]);
  deepStrictEqual(instruction.operands, []);
});

test("decodes int imm8", () => {
  const instruction = decodeOne(Uint8Array.from([0xcd, 0x2e]), 0, startAddress);

  strictEqual(instruction.address, startAddress);
  strictEqual(instruction.length, 2);
  strictEqual(0 + instruction.length, 2);
  strictEqual(instruction.mnemonic, "int");
  deepStrictEqual(instruction.raw, [0xcd, 0x2e]);
  deepStrictEqual(instruction.operands[0], { kind: "imm8", value: 0x2e, signedValue: 46 });
});

test("decodes unsupported opcode without throwing", () => {
  const instruction = decodeOne(Uint8Array.from([0x62]), 0, startAddress);

  strictEqual(instruction.address, startAddress);
  strictEqual(instruction.length, 1);
  strictEqual(instruction.mnemonic, "unsupported");
  deepStrictEqual(instruction.raw, [0x62]);
  deepStrictEqual(instruction.operands, []);
});
