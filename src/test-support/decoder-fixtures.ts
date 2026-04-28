import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../arch/x86/decoder/decoder.js";
import type { JccCondition } from "../arch/x86/instruction/condition.js";
import type { Mnemonic } from "../arch/x86/instruction/mnemonic.js";
import type { Operand } from "../arch/x86/instruction/types.js";
import type { Prefix } from "../arch/x86/instruction/prefix.js";
import { startAddress } from "./x86-code.js";

export type DecoderFixture = Readonly<{
  name: string;
  bytes: readonly number[];
  mnemonic: Mnemonic;
  operands?: readonly Operand[];
  address?: number;
  condition?: JccCondition;
  prefixes?: readonly Prefix[];
}>;

export function testDecoderFixtures(fixtures: readonly DecoderFixture[]): void {
  for (const fixture of fixtures) {
    test(`decodes ${fixture.name}`, () => {
      const address = fixture.address ?? startAddress;
      const instruction = decodeOne(Uint8Array.from(fixture.bytes), 0, address);

      strictEqual(instruction.address, address);
      strictEqual(instruction.length, fixture.bytes.length);
      strictEqual(instruction.mnemonic, fixture.mnemonic);
      strictEqual(instruction.condition, fixture.condition);
      deepStrictEqual(instruction.raw, fixture.bytes);
      deepStrictEqual(instruction.prefixes, fixture.prefixes ?? []);
      deepStrictEqual(instruction.operands, fixture.operands ?? []);
    });
  }
}
