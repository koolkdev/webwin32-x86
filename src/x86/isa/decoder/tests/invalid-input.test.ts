import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { test } from "node:test";

import { IsaDecodeError } from "#x86/isa/decoder/reader.js";
import { decodeBytes, startAddress } from "./helpers.js";

test("reports unsupported opcode without throwing", () => {
  const decoded = decodeBytes([0x62]);

  strictEqual(decoded.kind, "unsupported");
  if (decoded.kind === "unsupported") {
    strictEqual(decoded.address, startAddress);
    strictEqual(decoded.length, 1);
    strictEqual(decoded.unsupportedByte, 0x62);
    deepStrictEqual(decoded.raw, [0x62]);
  }
});

test("reports unsupported opcode after prefix without throwing", () => {
  const decoded = decodeBytes([0x66, 0x62]);

  strictEqual(decoded.kind, "unsupported");
  if (decoded.kind === "unsupported") {
    strictEqual(decoded.length, 2);
    strictEqual(decoded.unsupportedByte, 0x66);
    deepStrictEqual(decoded.raw, [0x66, 0x62]);
  }
});

test("truncated mov imm32 reports decode fault", () => {
  assertDecodeFault([0xb8, 0x01, 0x02]);
});

test("truncated opcode escape reports decode fault", () => {
  assertDecodeFault([0x0f]);
});

function assertDecodeFault(values: readonly number[]): void {
  throws(
    () => decodeBytes(values),
    (error: unknown) => {
      if (!(error instanceof IsaDecodeError)) {
        return false;
      }

      strictEqual(error.fault.reason, "truncated");
      return true;
    }
  );
}
