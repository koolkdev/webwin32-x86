import { strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeOne } from "../src/arch/x86/decoder/decoder.js";
import { StopReason } from "../src/core/execution/run-result.js";
import { createCpuState, getFlag, supportedEflagsMask, u32 } from "../src/core/state/cpu-state.js";
import { executeInstruction } from "../src/interp/interpreter.js";

const startAddress = 0x1000;

test("add_wrap_sets_cf_zf_af_pf", () => {
  const state = createCpuState({ eax: 0xffff_ffff, eip: startAddress });

  executeBytes(state, [0x81, 0xc0, 0x01, 0x00, 0x00, 0x00]);

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

  executeBytes(state, [0x81, 0xc0, 0x01, 0x00, 0x00, 0x00]);

  strictEqual(state.eax, 0x8000_0000);
  strictEqual(getFlag(state, "OF"), true);
  strictEqual(getFlag(state, "SF"), true);
  strictEqual(getFlag(state, "CF"), false);
  strictEqual(getFlag(state, "ZF"), false);
});

test("sub_borrow_sets_cf", () => {
  const state = createCpuState({ eax: 0, eip: startAddress });

  executeBytes(state, [0x81, 0xe8, 0x01, 0x00, 0x00, 0x00]);

  strictEqual(state.eax, 0xffff_ffff);
  strictEqual(getFlag(state, "CF"), true);
  strictEqual(getFlag(state, "SF"), true);
  strictEqual(getFlag(state, "ZF"), false);
  strictEqual(getFlag(state, "OF"), false);
  strictEqual(getFlag(state, "AF"), true);
});

test("sub_signed_overflow_sets_of", () => {
  const state = createCpuState({ eax: 0x8000_0000, eip: startAddress });

  executeBytes(state, [0x81, 0xe8, 0x01, 0x00, 0x00, 0x00]);

  strictEqual(state.eax, 0x7fff_ffff);
  strictEqual(getFlag(state, "OF"), true);
  strictEqual(getFlag(state, "SF"), false);
});

test("add_83_sign_extends", () => {
  const state = createCpuState({ eax: 2, eip: startAddress });

  executeBytes(state, [0x83, 0xc0, 0xff]);

  strictEqual(state.eax, 1);
});

test("arithmetic_preserves_unsupported_eflags_bits", () => {
  const unsupportedBits = u32(0xffff_ffff & ~supportedEflagsMask);
  const state = createCpuState({ eax: 1, eip: startAddress, eflags: unsupportedBits });

  executeBytes(state, [0x81, 0xc0, 0x01, 0x00, 0x00, 0x00]);

  strictEqual(u32(state.eflags & ~supportedEflagsMask), unsupportedBits);
});

function executeBytes(state: ReturnType<typeof createCpuState>, bytes: readonly number[]): void {
  const instruction = decodeOne(Uint8Array.from(bytes), 0, state.eip);
  const result = executeInstruction(state, instruction);

  strictEqual(result.stopReason, StopReason.NONE);
}
