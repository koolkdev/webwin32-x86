import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeBlock } from "../src/arch/x86/block-decoder/decode-block.js";
import type { DecodeReader, DecodeRegion } from "../src/arch/x86/block-decoder/decode-reader.js";
import type { DecodeFault } from "../src/arch/x86/decoder/decode-error.js";

const startAddress = 0x1000;
const hostAddress = 0x7000_1000;

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
    new SyntheticDecodeReader([
      {
        kind: "host-thunk",
        address: hostAddress,
        name: "test.host",
        hostCallId: 7,
        convention: "stdcall"
      }
    ]),
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
    new SyntheticDecodeReader([
      {
        kind: "guest-bytes",
        baseAddress: startAddress,
        bytes: Uint8Array.from(bytes)
      }
    ]),
    startAddress
  );
}

function mnemonics(instructions: readonly { mnemonic: string }[]): string[] {
  return instructions.map((instruction) => instruction.mnemonic);
}

class SyntheticDecodeReader implements DecodeReader {
  readonly identity = "synthetic";

  constructor(readonly regions: readonly DecodeRegion[]) {}

  regionAt(eip: number): DecodeRegion | undefined {
    for (const region of this.regions) {
      if (region.kind === "host-thunk" && region.address === eip) {
        return region;
      }

      if (region.kind === "guest-bytes") {
        const offset = eip - region.baseAddress;

        if (offset >= 0 && offset < region.bytes.length) {
          return region;
        }
      }
    }

    return undefined;
  }

  readU8(eip: number): number | DecodeFault {
    const region = this.regionAt(eip);

    if (region?.kind !== "guest-bytes") {
      return decodeFault(eip);
    }

    const offset = eip - region.baseAddress;
    const value = region.bytes[offset];

    return value ?? decodeFault(eip);
  }

  sliceFrom(eip: number, maxBytes: number): Uint8Array<ArrayBufferLike> | DecodeFault {
    const region = this.regionAt(eip);

    if (region?.kind !== "guest-bytes") {
      return decodeFault(eip);
    }

    const offset = eip - region.baseAddress;

    return region.bytes.slice(offset, offset + maxBytes);
  }
}

function decodeFault(eip: number): DecodeFault {
  return {
    reason: "truncated",
    address: eip,
    offset: 0,
    raw: []
  };
}
