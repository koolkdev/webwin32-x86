import { deepStrictEqual, doesNotThrow, strictEqual } from "node:assert";
import { test } from "node:test";

import {
  ArrayBufferGuestMemory,
  type GuestMemory,
  type MemoryReadResult,
  type MemoryWriteResult
} from "../src/core/memory/guest-memory.js";

test("u32_little_endian_roundtrip", () => {
  const memory = new ArrayBufferGuestMemory(8);

  assertWriteOk(memory.writeU32(0, 0x1234_5678));

  deepStrictEqual(readBytes(memory, 0, 4), [0x78, 0x56, 0x34, 0x12]);
  strictEqual(readValue(memory.readU32(0)), 0x1234_5678);
});

test("u16_little_endian_roundtrip", () => {
  const memory = new ArrayBufferGuestMemory(4);

  assertWriteOk(memory.writeU16(0, 0x1234));

  deepStrictEqual(readBytes(memory, 0, 2), [0x34, 0x12]);
  strictEqual(readValue(memory.readU16(0)), 0x1234);
});

test("u8_roundtrip", () => {
  const memory = new ArrayBufferGuestMemory(1);

  assertWriteOk(memory.writeU8(0, 0x1234));

  strictEqual(readValue(memory.readU8(0)), 0x34);
});

test("read_oob_reports_fault", () => {
  const memory = new ArrayBufferGuestMemory(4);
  let result: MemoryReadResult | undefined;

  doesNotThrow(() => {
    result = memory.readU8(4);
  });

  deepStrictEqual(result, {
    ok: false,
    fault: { faultAddress: 4, faultSize: 1, faultOperation: "read" }
  });
});

test("write_oob_does_not_partially_mutate", () => {
  const memory = new ArrayBufferGuestMemory(4);

  for (let address = 0; address < memory.byteLength; address += 1) {
    assertWriteOk(memory.writeU8(address, 0xaa));
  }

  const before = readBytes(memory, 0, memory.byteLength);
  const result = memory.writeU32(2, 0x1234_5678);

  deepStrictEqual(result, {
    ok: false,
    fault: { faultAddress: 2, faultSize: 4, faultOperation: "write" }
  });
  deepStrictEqual(readBytes(memory, 0, memory.byteLength), before);
});

test("u32_last_valid_address_succeeds", () => {
  const memory = new ArrayBufferGuestMemory(8);

  assertWriteOk(memory.writeU32(4, 0x89ab_cdef));

  strictEqual(readValue(memory.readU32(4)), 0x89ab_cdef);
});

test("u32_crosses_end_faults", () => {
  const memory = new ArrayBufferGuestMemory(8);

  deepStrictEqual(memory.readU32(5), {
    ok: false,
    fault: { faultAddress: 5, faultSize: 4, faultOperation: "read" }
  });
});

test("u32_address_ffffffff_faults", () => {
  const memory = new ArrayBufferGuestMemory(8);

  deepStrictEqual(memory.readU32(0xffff_ffff), {
    ok: false,
    fault: { faultAddress: 0xffff_ffff, faultSize: 4, faultOperation: "read" }
  });
});

function readBytes(memory: GuestMemory, address: number, length: number): number[] {
  const bytes = [];

  for (let index = 0; index < length; index += 1) {
    bytes.push(readValue(memory.readU8(address + index)));
  }

  return bytes;
}

function readValue(result: MemoryReadResult): number {
  if (!result.ok) {
    throw new Error(`unexpected memory fault at 0x${result.fault.faultAddress.toString(16)}`);
  }

  return result.value;
}

function assertWriteOk(result: MemoryWriteResult): void {
  if (!result.ok) {
    throw new Error(`unexpected memory fault at 0x${result.fault.faultAddress.toString(16)}`);
  }
}
