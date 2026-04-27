import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { test } from "node:test";

import { DecodeError } from "../src/arch/x86/decoder/decode-error.js";
import { decodeOne } from "../src/arch/x86/decoder/decoder.js";

const startAddress = 0x1000;

test("decodes operand-size-override-prefixed nop", () => {
  const instruction = decodeOne(Uint8Array.from([0x66, 0x90]), 0, startAddress);

  strictEqual(instruction.address, startAddress);
  strictEqual(instruction.length, 2);
  strictEqual(instruction.mnemonic, "nop");
  deepStrictEqual(instruction.raw, [0x66, 0x90]);
  deepStrictEqual(instruction.prefixes, [{ kind: "operandSizeOverride", byte: 0x66 }]);
});

test("operand-size override prefix does not silently decode mov r32 imm32", () => {
  const instruction = decodeOne(Uint8Array.from([0x66, 0xb8, 0x34, 0x12]), 0, startAddress);

  strictEqual(instruction.address, startAddress);
  strictEqual(instruction.mnemonic, "unsupported");
  deepStrictEqual(instruction.raw, [0x66, 0xb8, 0x34, 0x12]);
  deepStrictEqual(instruction.prefixes, [{ kind: "operandSizeOverride", byte: 0x66 }]);
});

test("truncated mov imm32 reports decode fault", () => {
  assertDecodeFault([0xb8, 0x01, 0x02], "truncated");
});

test("truncated opcode escape reports decode fault", () => {
  assertDecodeFault([0x0f], "truncated");
});

test("prefix without opcode reports decode fault", () => {
  assertDecodeFault([0x66], "truncated");
});

test("instruction longer than 15 bytes reports decode fault", () => {
  assertDecodeFault(
    [0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x90],
    "instructionTooLong"
  );
});

function assertDecodeFault(bytes: readonly number[], reason: "truncated" | "instructionTooLong"): void {
  throws(
    () => decodeOne(Uint8Array.from(bytes), 0, startAddress),
    (error: unknown) => {
      if (!(error instanceof DecodeError)) {
        return false;
      }

      strictEqual(error.fault.reason, reason);
      strictEqual(error.fault.address, startAddress);
      strictEqual(error.fault.offset, 0);
      deepStrictEqual(error.fault.raw, bytes.slice(0, 16));
      return true;
    }
  );
}
