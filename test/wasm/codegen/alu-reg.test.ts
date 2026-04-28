import { deepStrictEqual } from "node:assert";
import { test } from "node:test";

import { createCpuState } from "../../../src/core/state/cpu-state.js";
import { ExitReason } from "../../../src/wasm/exit.js";
import {
  assertWasmMatchesInterpreter,
  startAddress
} from "../../../src/test-support/wasm-codegen.js";

test("jit_add_reg_updates_flags", async () => {
  await assertWasmMatchesInterpreter([0x01, 0xd8], createCpuState({
    eax: 0xffff_ffff,
    ebx: 1,
    eflags: 0xffff_0000,
    eip: startAddress
  }));
});

test("jit_sub_reg_updates_flags", async () => {
  await assertWasmMatchesInterpreter([0x29, 0xd8], createCpuState({
    eax: 0,
    ebx: 1,
    eflags: 0xffff_0000,
    eip: startAddress
  }));
});

test("jit_xor_reg_updates_flags", async () => {
  await assertWasmMatchesInterpreter([0x31, 0xd8], createCpuState({
    eax: 0x8000_0080,
    ebx: 0x0000_00ff,
    eflags: 0xffff_0000,
    eip: startAddress
  }));
});

test("jit_alu_sequence_matches_interpreter", async () => {
  const bytes = [
    0xb8, 0xff, 0xff, 0xff, 0xff,
    0xbb, 0x01, 0x00, 0x00, 0x00,
    0x01, 0xd8,
    0x31, 0xdb,
    0x29, 0xd8
  ];
  const { wasmResult } = await assertWasmMatchesInterpreter(bytes, createCpuState({ eip: startAddress }));

  deepStrictEqual(wasmResult.exit, {
    exitReason: ExitReason.FALLTHROUGH,
    payload: 0x1010
  });
});
