import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { rawX86FixtureFromJson } from "../../../src/lab/fixtures/raw-x86-fixture.js";

test("raw_x86_fixture_json_defines_inline_bytes", () => {
  const fixture = rawX86FixtureFromJson({
    id: "inline_mov",
    bytes: [0xb8, 0x01, 0x00, 0x00, 0x00],
    loadAddress: 0x1000
  });

  strictEqual(fixture.id, "inline_mov");
  deepStrictEqual([...fixture.bytes], [0xb8, 0x01, 0x00, 0x00, 0x00]);
  strictEqual(fixture.loadAddress, 0x1000);
  strictEqual(fixture.entryEip, 0x1000);
});

test("raw_x86_fixture_allows_explicit_entry", () => {
  const fixture = rawX86FixtureFromJson({
    id: "offset_entry",
    bytes: [0x90],
    loadAddress: 0x1000,
    entryEip: 0x1004
  });

  strictEqual(fixture.entryEip, 0x1004);
});

test("raw_x86_fixture_keeps_initial_state", () => {
  const fixture = rawX86FixtureFromJson({
    id: "stateful",
    bytes: [0x90],
    loadAddress: 0x1000,
    initialState: {
      eax: 0x1234_5678,
      eflags: 0x202,
      esp: 0x8_0000
    },
    instructionLimit: 0x40
  });

  strictEqual(fixture.initialState.eax, 0x1234_5678);
  strictEqual(fixture.initialState.eflags, 0x202);
  strictEqual(fixture.initialState.esp, 0x8_0000);
  strictEqual(fixture.instructionLimit, 0x40);
});

test("raw_x86_fixture_keeps_memory_setup", () => {
  const fixture = rawX86FixtureFromJson({
    id: "memory",
    bytes: [0x90],
    loadAddress: 0x1000,
    memorySize: 0x1_0000,
    memory: [
      { address: 0x20, bytes: [1, 2, 3, 4] }
    ]
  });

  strictEqual(fixture.memorySize, 0x1_0000);
  strictEqual(fixture.memory[0]?.address, 0x20);
  deepStrictEqual([...(fixture.memory[0]?.bytes ?? [])], [1, 2, 3, 4]);
});

test("raw_x86_fixture_supports_expected_state", () => {
  const fixture = rawX86FixtureFromJson({
    id: "expected_state",
    bytes: [0x90],
    loadAddress: 0x1000,
    expectedState: {
      eax: 3,
      ecx: 2
    }
  });

  strictEqual(fixture.expectedState.eax, 3);
  strictEqual(fixture.expectedState.ecx, 2);
});
