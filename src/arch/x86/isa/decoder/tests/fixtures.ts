import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import type { Mem32Operand, Reg32 } from "../../types.js";
import { decodeIsaInstruction } from "../decode.js";
import type { IsaOperandBinding } from "../types.js";
import { startAddress } from "./helpers.js";

export type DecoderFixture = Readonly<{
  name: string;
  bytes: readonly number[];
  mnemonic: string;
  operands?: readonly IsaOperandBinding[];
  address?: number;
  id?: string;
  format?: string;
}>;

export function testDecodeFixtures(fixtures: readonly DecoderFixture[]): void {
  for (const fixture of fixtures) {
    test(`decodes ${fixture.name}`, () => {
      const address = fixture.address ?? startAddress;
      const decoded = decodeIsaInstruction(Uint8Array.from(fixture.bytes), 0, address);

      strictEqual(decoded.kind, "ok");
      if (decoded.kind !== "ok") {
        return;
      }

      strictEqual(decoded.instruction.address, address);
      strictEqual(decoded.instruction.length, fixture.bytes.length);
      strictEqual(decoded.instruction.spec.mnemonic, fixture.mnemonic);
      strictEqual(decoded.instruction.nextEip, address + fixture.bytes.length);
      deepStrictEqual(decoded.instruction.raw, fixture.bytes);
      deepStrictEqual(decoded.instruction.operands, fixture.operands ?? []);

      if (fixture.id !== undefined) {
        strictEqual(decoded.instruction.spec.id, fixture.id);
      }

      if (fixture.format !== undefined) {
        strictEqual(decoded.instruction.spec.format.syntax, fixture.format);
      }
    });
  }
}

export function reg32(reg: Reg32): IsaOperandBinding {
  return { kind: "reg32", reg };
}

export function mem32(operand: Omit<Mem32Operand, "kind">): Mem32Operand {
  return { kind: "mem32", ...operand };
}

export function imm32(value: number): IsaOperandBinding {
  return { kind: "imm32", value, encodedWidth: 32 };
}

export function imm16(value: number): IsaOperandBinding {
  return { kind: "imm32", value, encodedWidth: 16, extension: "zero" };
}

export function imm8(value: number): IsaOperandBinding {
  return { kind: "imm32", value, encodedWidth: 8 };
}

export function signImm8(value: number): IsaOperandBinding {
  return { kind: "imm32", value: value >>> 0, encodedWidth: 8, extension: "sign" };
}

export function relTarget(width: 8 | 32, displacement: number, target: number): IsaOperandBinding {
  return { kind: "relTarget", width, displacement, target };
}
