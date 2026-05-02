import type { GuestMemory, MemoryReadResult, MemoryWriteResult } from "../guest-memory.js";

export function fillGuestMemory(memory: GuestMemory, value: number): void {
  for (let address = 0; address < memory.byteLength; address += 1) {
    assertGuestWriteOk(memory.writeU8(address, value));
  }
}

export function writeGuestU32(memory: GuestMemory, address: number, value: number): void {
  assertGuestWriteOk(memory.writeU32(address, value));
}

export function writeGuestBytes(memory: GuestMemory, address: number, bytes: readonly number[]): void {
  for (let index = 0; index < bytes.length; index += 1) {
    assertGuestWriteOk(memory.writeU8(address + index, bytes[index] ?? 0));
  }
}

export function readGuestBytes(memory: GuestMemory, address: number, length: number): number[] {
  const bytes: number[] = [];

  for (let index = 0; index < length; index += 1) {
    bytes.push(readGuestValue(memory.readU8(address + index)));
  }

  return bytes;
}

export function readGuestValue(result: MemoryReadResult): number {
  if (!result.ok) {
    throw new Error(`unexpected memory fault at 0x${result.fault.faultAddress.toString(16)}`);
  }

  return result.value;
}

export function assertGuestWriteOk(result: MemoryWriteResult): void {
  if (!result.ok) {
    throw new Error(`unexpected memory fault at 0x${result.fault.faultAddress.toString(16)}`);
  }
}
