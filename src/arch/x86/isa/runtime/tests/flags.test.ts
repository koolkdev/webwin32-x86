import { strictEqual } from "node:assert";
import { test } from "node:test";

import {
  controlEflagsMask,
  createCpuState,
  getFlag,
  supportedEflagsMask,
  u32
} from "../../../../../core/state/cpu-state.js";
import { executeIsaInstruction } from "../execute.js";
import { decodeBytes, ok, startAddress } from "./helpers.js";

test("add_wrap_sets_cf_zf_af_pf", () => {
  const state = createCpuState({ eax: 0xffff_ffff, eip: startAddress });

  execute(state, [0x81, 0xc0, 0x01, 0x00, 0x00, 0x00]);

  strictEqual(state.eax, 0);
  strictEqual(getFlag(state, "CF"), true);
  strictEqual(getFlag(state, "ZF"), true);
  strictEqual(getFlag(state, "SF"), false);
  strictEqual(getFlag(state, "OF"), false);
  strictEqual(getFlag(state, "AF"), true);
  strictEqual(getFlag(state, "PF"), true);
});

test("add_signed_overflow_sets_of", () => {
  const state = createCpuState({ eax: 0x7fff_ffff, eip: startAddress });

  execute(state, [0x81, 0xc0, 0x01, 0x00, 0x00, 0x00]);

  strictEqual(state.eax, 0x8000_0000);
  strictEqual(getFlag(state, "OF"), true);
  strictEqual(getFlag(state, "SF"), true);
  strictEqual(getFlag(state, "CF"), false);
  strictEqual(getFlag(state, "ZF"), false);
});

test("sub_borrow_sets_cf", () => {
  const state = createCpuState({ eax: 0, eip: startAddress });

  execute(state, [0x81, 0xe8, 0x01, 0x00, 0x00, 0x00]);

  strictEqual(state.eax, 0xffff_ffff);
  strictEqual(getFlag(state, "CF"), true);
  strictEqual(getFlag(state, "SF"), true);
  strictEqual(getFlag(state, "ZF"), false);
  strictEqual(getFlag(state, "OF"), false);
  strictEqual(getFlag(state, "AF"), true);
});

test("sub_signed_overflow_sets_of", () => {
  const state = createCpuState({ eax: 0x8000_0000, eip: startAddress });

  execute(state, [0x81, 0xe8, 0x01, 0x00, 0x00, 0x00]);

  strictEqual(state.eax, 0x7fff_ffff);
  strictEqual(getFlag(state, "OF"), true);
  strictEqual(getFlag(state, "SF"), false);
});

test("add_83_sign_extends", () => {
  const state = createCpuState({ eax: 2, eip: startAddress });

  execute(state, [0x83, 0xc0, 0xff]);

  strictEqual(state.eax, 1);
});

test("arithmetic_preserves_unsupported_eflags_bits", () => {
  const unsupportedBits = u32(0xffff_ffff & ~supportedEflagsMask);
  const state = createCpuState({ eax: 1, eip: startAddress, eflags: unsupportedBits });

  execute(state, [0x81, 0xc0, 0x01, 0x00, 0x00, 0x00]);

  strictEqual(u32(state.eflags & ~supportedEflagsMask), unsupportedBits);
});

test("arithmetic_preserves_control_eflags_bits", () => {
  const state = createCpuState({ eax: 1, eip: startAddress, eflags: controlEflagsMask });

  execute(state, [0x81, 0xc0, 0x01, 0x00, 0x00, 0x00]);

  strictEqual(u32(state.eflags & controlEflagsMask), controlEflagsMask);
});

test("xor_clears_register_and_sets_zf", () => {
  const state = createCpuState({ eax: 0x1234, eip: startAddress });

  execute(state, [0x31, 0xc0]);

  strictEqual(state.eax, 0);
  strictEqual(getFlag(state, "ZF"), true);
  strictEqual(getFlag(state, "SF"), false);
  strictEqual(getFlag(state, "CF"), false);
  strictEqual(getFlag(state, "OF"), false);
  strictEqual(getFlag(state, "AF"), false);
});

test("cmp_equal_sets_zf_without_write", () => {
  const state = createCpuState({ eax: 5, eip: startAddress });

  execute(state, [0x81, 0xf8, 0x05, 0x00, 0x00, 0x00]);

  strictEqual(state.eax, 5);
  strictEqual(getFlag(state, "ZF"), true);
  strictEqual(getFlag(state, "CF"), false);
});

test("cmp_less_unsigned_sets_cf", () => {
  const state = createCpuState({ eax: 1, eip: startAddress });

  execute(state, [0x81, 0xf8, 0x02, 0x00, 0x00, 0x00]);

  strictEqual(state.eax, 1);
  strictEqual(getFlag(state, "CF"), true);
  strictEqual(getFlag(state, "ZF"), false);
});

test("cmp_imm8_sign_extended", () => {
  const state = createCpuState({ eax: 0, eip: startAddress });

  execute(state, [0x83, 0xf8, 0xff]);

  strictEqual(state.eax, 0);
  strictEqual(getFlag(state, "CF"), true);
});

test("test_sets_zf_without_write", () => {
  const state = createCpuState({ eax: 0x10, ebx: 0x20, eip: startAddress });

  execute(state, [0x85, 0xd8]);

  strictEqual(state.eax, 0x10);
  strictEqual(state.ebx, 0x20);
  strictEqual(getFlag(state, "ZF"), true);
  strictEqual(getFlag(state, "CF"), false);
  strictEqual(getFlag(state, "OF"), false);
});

test("test_sets_sf_from_bit31", () => {
  const state = createCpuState({ eax: 0x8000_0000, ebx: 0xffff_ffff, eip: startAddress });

  execute(state, [0x85, 0xd8]);

  strictEqual(getFlag(state, "SF"), true);
  strictEqual(getFlag(state, "ZF"), false);
  strictEqual(getFlag(state, "CF"), false);
  strictEqual(getFlag(state, "OF"), false);
});

test("test_sets_pf_from_low_byte", () => {
  const state = createCpuState({ eax: 0x80, ebx: 0xff, eip: startAddress });

  execute(state, [0x85, 0xd8]);

  strictEqual(getFlag(state, "PF"), false);
  strictEqual(getFlag(state, "SF"), false);
});

function execute(state: ReturnType<typeof createCpuState>, values: readonly number[]): void {
  const decoded = ok(decodeBytes(values, state.eip));

  executeIsaInstruction(state, decoded);
}
