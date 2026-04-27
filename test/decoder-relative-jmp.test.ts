import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import type { Operand } from "../src/arch/x86/instruction/types.js";

const startAddress = 0x1000;

const fixtures: readonly RelativeJumpFixture[] = [
  {
    bytes: [0xeb, 0x05],
    kind: "rel8",
    displacement: 5,
    target: 0x1007,
    length: 2
  },
  {
    bytes: [0xeb, 0xfe],
    kind: "rel8",
    displacement: -2,
    target: 0x1000,
    length: 2
  },
  {
    bytes: [0xe9, 0xfb, 0xff, 0xff, 0xff],
    kind: "rel32",
    displacement: -5,
    target: 0x1000,
    length: 5
  }
];

for (const fixture of fixtures) {
  test(`decodes jmp ${fixture.kind} ${fixture.displacement}`, () => {
    const instruction = decodeOne(Uint8Array.from(fixture.bytes), 0, startAddress);

    strictEqual(instruction.address, startAddress);
    strictEqual(instruction.mnemonic, "jmp");
    strictEqual(instruction.length, fixture.length);
    deepStrictEqual(instruction.raw, fixture.bytes);
    deepStrictEqual(instruction.operands[0], {
      kind: fixture.kind,
      displacement: fixture.displacement,
      target: fixture.target
    });
  });
}

type RelativeJumpFixture = Readonly<{
  bytes: readonly number[];
  kind: Extract<Operand["kind"], "rel8" | "rel32">;
  displacement: number;
  target: number;
  length: number;
}>;
