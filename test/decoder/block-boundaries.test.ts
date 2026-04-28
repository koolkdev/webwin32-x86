import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeBlock } from "../../src/arch/x86/block-decoder/decode-block.js";
import { guestBytesRegion, hostThunkRegion, TestDecodeReader } from "../../src/test-support/decode-reader.js";
import { hostAddress, startAddress } from "../../src/test-support/x86-code.js";

test("stops block after jmp terminator", () => {
  const block = decodeGuestBytes([0x90, 0xeb, 0x00, 0x90]);

  deepStrictEqual(mnemonics(block.instructions), ["nop", "jmp"]);
  strictEqual(block.terminator.kind, "jump");
  strictEqual(block.terminator.targetEip, 0x1003);
});

test("stops block after ret terminator", () => {
  const block = decodeGuestBytes([0x90, 0xc3, 0x90]);

  deepStrictEqual(mnemonics(block.instructions), ["nop", "ret"]);
  strictEqual(block.terminator.kind, "ret");
});

test("stops block after int terminator", () => {
  const block = decodeGuestBytes([0x90, 0xcd, 0x2e, 0x90]);

  deepStrictEqual(mnemonics(block.instructions), ["nop", "int"]);
  strictEqual(block.terminator.kind, "int");
  strictEqual(block.terminator.vector, 0x2e);
});

test("stops block at unsupported terminator", () => {
  const block = decodeGuestBytes([0x90, 0x62, 0x90]);

  deepStrictEqual(mnemonics(block.instructions), ["nop", "unsupported"]);
  strictEqual(block.terminator.kind, "unsupported");
  strictEqual(block.terminator.eip, 0x1001);
});

test("stops block at decode fault boundary", () => {
  const block = decodeGuestBytes([0x90, 0xb8, 0x01, 0x02]);

  deepStrictEqual(mnemonics(block.instructions), ["nop"]);
  strictEqual(block.terminator.kind, "decode-fault");
  strictEqual(block.terminator.fault.reason, "truncated");
  strictEqual(block.terminator.fault.address, 0x1001);
  deepStrictEqual(block.terminator.fault.raw, [0xb8, 0x01, 0x02]);
});

test("host thunk boundary does not decode fake bytes", () => {
  const block = decodeBlock(
    new TestDecodeReader([hostThunkRegion(7)]),
    hostAddress
  );

  strictEqual(block.instructions.length, 0);
  strictEqual(block.terminator.kind, "host-call");
  strictEqual(block.terminator.eip, hostAddress);
  strictEqual(block.terminator.hostCallId, 7);
  strictEqual(block.terminator.name, "test.host");
  strictEqual(block.terminator.convention, "stdcall");
});

function decodeGuestBytes(bytes: readonly number[]) {
  return decodeBlock(
    new TestDecodeReader([guestBytesRegion(bytes)]),
    startAddress
  );
}

function mnemonics(instructions: readonly { mnemonic: string }[]): string[] {
  return instructions.map((instruction) => instruction.mnemonic);
}
