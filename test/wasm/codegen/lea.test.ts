import { strictEqual } from "node:assert";
import { test } from "node:test";

import { createCpuState } from "../../../src/core/state/cpu-state.js";
import {
  assertWasmMatchesInterpreter,
  readStateU32,
  startAddress
} from "../../../src/test-support/wasm-codegen.js";

test("jit_lea_base_disp_matches_interpreter", async () => {
  const { wasmResult } = await assertWasmMatchesInterpreter(
    [0x8d, 0x43, 0x10],
    createCpuState({ ebx: 0x100, eip: startAddress })
  );

  strictEqual(readStateU32(wasmResult.stateView, "eax"), 0x110);
});

test("jit_lea_sib_matches_interpreter", async () => {
  const { wasmResult } = await assertWasmMatchesInterpreter(
    [0x8d, 0x44, 0x8b, 0x10],
    createCpuState({ ebx: 0x100, ecx: 3, eip: startAddress })
  );

  strictEqual(readStateU32(wasmResult.stateView, "eax"), 0x11c);
});

test("jit_lea_absolute_disp_matches_interpreter", async () => {
  const { wasmResult } = await assertWasmMatchesInterpreter(
    [0x8d, 0x05, 0x78, 0x56, 0x34, 0x12],
    createCpuState({ eax: 0xffff_ffff, eip: startAddress })
  );

  strictEqual(readStateU32(wasmResult.stateView, "eax"), 0x1234_5678);
});

test("jit_lea_wrap_matches_interpreter", async () => {
  const { wasmResult } = await assertWasmMatchesInterpreter(
    [0x8d, 0x04, 0xcb],
    createCpuState({ ebx: 0xffff_fff0, ecx: 3, eflags: 0x8d5, eip: startAddress })
  );

  strictEqual(readStateU32(wasmResult.stateView, "eax"), 8);
  strictEqual(readStateU32(wasmResult.stateView, "eflags"), 0x8d5);
});
