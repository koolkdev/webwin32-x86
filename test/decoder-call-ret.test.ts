import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";

const startAddress = 0x1000;

test("decodes call rel32", () => {
  const bytes = [0xe8, 0x05, 0x00, 0x00, 0x00];
  const instruction = decodeOne(Uint8Array.from(bytes), 0, startAddress);

  strictEqual(instruction.mnemonic, "call");
  strictEqual(instruction.length, 5);
  deepStrictEqual(instruction.raw, bytes);
  deepStrictEqual(instruction.operands[0], {
    kind: "rel32",
    displacement: 5,
    target: 0x100a
  });
});

test("decodes ret", () => {
  const bytes = [0xc3];
  const instruction = decodeOne(Uint8Array.from(bytes), 0, startAddress);

  strictEqual(instruction.mnemonic, "ret");
  strictEqual(instruction.length, 1);
  deepStrictEqual(instruction.raw, bytes);
  deepStrictEqual(instruction.operands, []);
});

test("decodes ret imm16", () => {
  const bytes = [0xc2, 0x08, 0x00];
  const instruction = decodeOne(Uint8Array.from(bytes), 0, startAddress);

  strictEqual(instruction.mnemonic, "ret");
  strictEqual(instruction.length, 3);
  deepStrictEqual(instruction.raw, bytes);
  deepStrictEqual(instruction.operands[0], { kind: "imm16", value: 8 });
});
