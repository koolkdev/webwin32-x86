import { strictEqual } from "node:assert";
import { test } from "node:test";

import { createCpuState, getFlag } from "../../src/core/state/cpu-state.js";
import { executeBytes, startAddress } from "../../src/test-support/interpreter.js";

test("xor_clears_register_and_sets_zf", () => {
  const state = createCpuState({ eax: 0x1234, eip: startAddress });

  executeBytes(state, [0x31, 0xc0]);

  strictEqual(state.eax, 0);
  strictEqual(getFlag(state, "ZF"), true);
  strictEqual(getFlag(state, "SF"), false);
  strictEqual(getFlag(state, "CF"), false);
  strictEqual(getFlag(state, "OF"), false);
  strictEqual(getFlag(state, "AF"), false);
});

test("cmp_equal_sets_zf_without_write", () => {
  const state = createCpuState({ eax: 5, eip: startAddress });

  executeBytes(state, [0x81, 0xf8, 0x05, 0x00, 0x00, 0x00]);

  strictEqual(state.eax, 5);
  strictEqual(getFlag(state, "ZF"), true);
  strictEqual(getFlag(state, "CF"), false);
});

test("cmp_less_unsigned_sets_cf", () => {
  const state = createCpuState({ eax: 1, eip: startAddress });

  executeBytes(state, [0x81, 0xf8, 0x02, 0x00, 0x00, 0x00]);

  strictEqual(state.eax, 1);
  strictEqual(getFlag(state, "CF"), true);
  strictEqual(getFlag(state, "ZF"), false);
});

test("cmp_imm8_sign_extended", () => {
  const state = createCpuState({ eax: 0, eip: startAddress });

  executeBytes(state, [0x83, 0xf8, 0xff]);

  strictEqual(state.eax, 0);
  strictEqual(getFlag(state, "CF"), true);
});

test("test_sets_zf_without_write", () => {
  const state = createCpuState({ eax: 0x10, ebx: 0x20, eip: startAddress });

  executeBytes(state, [0x85, 0xd8]);

  strictEqual(state.eax, 0x10);
  strictEqual(state.ebx, 0x20);
  strictEqual(getFlag(state, "ZF"), true);
  strictEqual(getFlag(state, "CF"), false);
  strictEqual(getFlag(state, "OF"), false);
});

test("test_sets_sf_from_bit31", () => {
  const state = createCpuState({ eax: 0x8000_0000, ebx: 0xffff_ffff, eip: startAddress });

  executeBytes(state, [0x85, 0xd8]);

  strictEqual(getFlag(state, "SF"), true);
  strictEqual(getFlag(state, "ZF"), false);
  strictEqual(getFlag(state, "CF"), false);
  strictEqual(getFlag(state, "OF"), false);
});

test("test_sets_pf_from_low_byte", () => {
  const state = createCpuState({ eax: 0x80, ebx: 0xff, eip: startAddress });

  executeBytes(state, [0x85, 0xd8]);

  strictEqual(getFlag(state, "PF"), false);
  strictEqual(getFlag(state, "SF"), false);
});
