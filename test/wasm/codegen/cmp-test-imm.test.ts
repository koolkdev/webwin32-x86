import { strictEqual } from "node:assert";
import { test } from "node:test";

import { createCpuState, eflagsMask, getFlag } from "../../../src/core/state/cpu-state.js";
import {
  assertWasmMatchesInterpreter as assertMatchesInterpreter,
  readStateU32,
  startAddress
} from "../../../src/test-support/wasm-codegen.js";

test("jit_cmp_equal_sets_zf", async () => {
  const initialState = createCpuState({ eax: 5, ebx: 5, eflags: 0xffff_0000, eip: startAddress });
  const { wasmResult, interpreterState } = await assertMatchesInterpreter([0x39, 0xd8], initialState);

  strictEqual(readStateU32(wasmResult.stateView, "eax"), initialState.eax);
  strictEqual(readStateU32(wasmResult.stateView, "ebx"), initialState.ebx);
  strictEqual(getFlag(interpreterState, "ZF"), true);
});

test("jit_cmp_imm8_sign_extended", async () => {
  const { interpreterState } = await assertMatchesInterpreter(
    [0x83, 0xf8, 0xff],
    createCpuState({ eax: 0, eflags: 0xffff_0000, eip: startAddress })
  );

  strictEqual(getFlag(interpreterState, "CF"), true);
});

test("jit_test_reg_reg_sets_flags", async () => {
  const initialState = createCpuState({ eax: 0x10, ebx: 0x20, eflags: 0xffff_0000, eip: startAddress });
  const { wasmResult, interpreterState } = await assertMatchesInterpreter([0x85, 0xd8], initialState);

  strictEqual(readStateU32(wasmResult.stateView, "eax"), initialState.eax);
  strictEqual(readStateU32(wasmResult.stateView, "ebx"), initialState.ebx);
  strictEqual(getFlag(interpreterState, "ZF"), true);
});

test("jit_add_imm32_matches_interpreter", async () => {
  await assertMatchesInterpreter(
    [0x81, 0xc0, 0x01, 0x00, 0x00, 0x00],
    createCpuState({ eax: 0xffff_ffff, eflags: 0xffff_0000, eip: startAddress })
  );
});

test("jit_sub_imm8_loop_counter", async () => {
  const { wasmResult } = await assertMatchesInterpreter(
    [0x83, 0xe8, 0x01],
    createCpuState({ eax: 3, eflags: 0xffff_0000, eip: startAddress })
  );

  strictEqual(readStateU32(wasmResult.stateView, "eax"), 2);
});

test("jit_cmp_then_jz_fixture_ready", async () => {
  const { wasmResult } = await assertMatchesInterpreter(
    [0x81, 0xf8, 0x00, 0x00, 0x00, 0x00],
    createCpuState({ eax: 0, eflags: 0xffff_0000, eip: startAddress })
  );
  const eflags = readStateU32(wasmResult.stateView, "eflags");

  strictEqual((eflags & eflagsMask.ZF) !== 0, true);
  strictEqual((eflags & eflagsMask.CF) !== 0, false);
});
