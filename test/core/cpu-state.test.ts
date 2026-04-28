import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { reg32 } from "../../src/arch/x86/instruction/types.js";
import {
  cpuFlags,
  createCpuState,
  cloneCpuState,
  copyCpuState,
  cpuStatesEqual,
  eflagsMask,
  getFlag,
  getReg32,
  hasEvenParityLowByte,
  setFlag,
  setReg32,
  STATE_BYTE_LENGTH,
  STATE_OFFSETS,
  supportedEflagsMask,
  u32
} from "../../src/core/state/cpu-state.js";

test("initial_state_zeroes_registers", () => {
  const state = createCpuState();

  for (const reg of reg32) {
    strictEqual(getReg32(state, reg), 0);
  }

  strictEqual(state.eip, 0);
  strictEqual(state.eflags, 0);
  strictEqual(state.instructionCount, 0);
  strictEqual(state.stopReason, 0);

  for (const flag of cpuFlags) {
    strictEqual(getFlag(state, flag), false);
  }
});

test("register_roundtrip_all_gprs", () => {
  const state = createCpuState();

  for (const [index, reg] of reg32.entries()) {
    const value = 0x1_0000_0000 + index;
    setReg32(state, reg, value);

    strictEqual(getReg32(state, reg), u32(value));
  }
});

test("flag_roundtrip_supported_subset", () => {
  const state = createCpuState();

  for (const flag of cpuFlags) {
    setFlag(state, flag, true);
    strictEqual(getFlag(state, flag), true);

    for (const other of cpuFlags) {
      if (other !== flag) {
        strictEqual(getFlag(state, other), false);
      }
    }

    setFlag(state, flag, false);
    strictEqual(getFlag(state, flag), false);
  }
});

test("unsupported_eflags_bits_preserved", () => {
  const unsupportedBits = u32(0xffff_ffff & ~supportedEflagsMask);
  const state = createCpuState({ eflags: unsupportedBits });

  for (const flag of cpuFlags) {
    setFlag(state, flag, true);
    strictEqual(u32(state.eflags & ~supportedEflagsMask), unsupportedBits);

    setFlag(state, flag, false);
    strictEqual(u32(state.eflags & ~supportedEflagsMask), unsupportedBits);
  }
});

test("parity_low_byte", () => {
  for (const value of [0x00, 0x03, 0xff]) {
    strictEqual(hasEvenParityLowByte(value), true);
  }

  for (const value of [0x01, 0x07]) {
    strictEqual(hasEvenParityLowByte(value), false);
  }
});

test("state_offsets_match_abi", () => {
  deepStrictEqual(STATE_OFFSETS, {
    eax: 0,
    ecx: 4,
    edx: 8,
    ebx: 12,
    esp: 16,
    ebp: 20,
    esi: 24,
    edi: 28,
    eip: 32,
    eflags: 36,
    instructionCount: 40,
    stopReason: 44
  });
  strictEqual(STATE_BYTE_LENGTH, 48);
  deepStrictEqual(eflagsMask, {
    CF: 1 << 0,
    PF: 1 << 2,
    AF: 1 << 4,
    ZF: 1 << 6,
    SF: 1 << 7,
    OF: 1 << 11
  });
});

test("state_clone_copy_and_compare", () => {
  const source = createCpuState({
    eax: 0xffff_ffff,
    ecx: 0x1_0000_0001,
    eip: 0x1000,
    eflags: eflagsMask.CF,
    instructionCount: 7,
    stopReason: 3
  });
  const clone = cloneCpuState(source);
  const target = createCpuState();

  strictEqual(cpuStatesEqual(source, clone), true);

  clone.eax = 0;
  strictEqual(cpuStatesEqual(source, clone), false);

  copyCpuState(source, target);
  strictEqual(cpuStatesEqual(source, target), true);
});
