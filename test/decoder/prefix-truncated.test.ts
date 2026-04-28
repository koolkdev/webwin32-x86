import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { test } from "node:test";

import { DecodeError } from "../../src/arch/x86/decoder/decode-error.js";
import { decodeOne } from "../../src/arch/x86/decoder/decoder.js";
import { testDecoderFixtures } from "../../src/test-support/decoder-fixtures.js";
import { startAddress } from "../../src/test-support/x86-code.js";

testDecoderFixtures([
  {
    name: "operand-size-override-prefixed nop",
    bytes: [0x66, 0x90],
    mnemonic: "nop",
    prefixes: [{ kind: "operandSizeOverride", byte: 0x66 }]
  },
  {
    name: "operand-size override prefix does not silently decode mov r32 imm32",
    bytes: [0x66, 0xb8, 0x34, 0x12],
    mnemonic: "unsupported",
    prefixes: [{ kind: "operandSizeOverride", byte: 0x66 }]
  }
]);

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
