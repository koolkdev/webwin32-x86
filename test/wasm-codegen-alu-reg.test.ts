import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason } from "../src/core/execution/run-result.js";
import { cloneCpuState, cpuStateFields, createCpuState, type CpuState } from "../src/core/state/cpu-state.js";
import { runInstructionInterpreter } from "../src/interp/interpreter.js";
import { ExitReason } from "../src/wasm/exit.js";
import {
  decodeBytes,
  readStateU32,
  runCompiledBlock,
  startAddress
} from "../src/test-support/wasm-codegen.js";

test("jit_add_reg_updates_flags", async () => {
  await assertMatchesInterpreter([0x01, 0xd8], createCpuState({
    eax: 0xffff_ffff,
    ebx: 1,
    eflags: 0xffff_0000,
    eip: startAddress
  }));
});

test("jit_sub_reg_updates_flags", async () => {
  await assertMatchesInterpreter([0x29, 0xd8], createCpuState({
    eax: 0,
    ebx: 1,
    eflags: 0xffff_0000,
    eip: startAddress
  }));
});

test("jit_xor_reg_updates_flags", async () => {
  await assertMatchesInterpreter([0x31, 0xd8], createCpuState({
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
  const { wasmResult, interpreterState } = await runBoth(bytes, createCpuState({ eip: startAddress }));

  for (const field of cpuStateFields) {
    strictEqual(readStateU32(wasmResult.stateView, field), interpreterState[field]);
  }

  deepStrictEqual(wasmResult.exit, {
    exitReason: ExitReason.FALLTHROUGH,
    payload: 0x1010
  });
});

async function assertMatchesInterpreter(bytes: readonly number[], initialState: CpuState): Promise<void> {
  const { wasmResult, interpreterState, interpreterResult } = await runBoth(bytes, initialState);

  strictEqual(interpreterResult.stopReason, StopReason.NONE);

  for (const field of cpuStateFields) {
    strictEqual(readStateU32(wasmResult.stateView, field), interpreterState[field]);
  }
}

async function runBoth(bytes: readonly number[], initialState: CpuState): Promise<RunBothResult> {
  const instructions = decodeBytes(bytes);
  const interpreterState = cloneCpuState(initialState);
  const interpreterResult = runInstructionInterpreter(interpreterState, instructions);
  const wasmResult = await runCompiledBlock(bytes, initialState);

  return {
    interpreterResult,
    interpreterState,
    wasmResult
  };
}

type RunBothResult = Readonly<{
  interpreterResult: ReturnType<typeof runInstructionInterpreter>;
  interpreterState: CpuState;
  wasmResult: Awaited<ReturnType<typeof runCompiledBlock>>;
}>;
