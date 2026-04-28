import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason } from "../src/core/execution/run-result.js";
import { createCpuState, type CpuState } from "../src/core/state/cpu-state.js";
import { runInstructionInterpreter } from "../src/interp/interpreter.js";
import { ExitReason } from "../src/wasm/exit.js";
import {
  decodeBytes,
  readStateU32,
  runCompiledBlock,
  startAddress,
  stateFields
} from "../src/test-support/wasm-codegen.js";

test("jit_mov_ecx_eax", async () => {
  const initialState = createCpuState({ eax: 0x1234_5678, ecx: 0, eip: startAddress });
  const result = await runCompiledBlock([0x89, 0xc1], initialState);

  strictEqual(readStateU32(result.stateView, "ecx"), 0x1234_5678);
  strictEqual(readStateU32(result.stateView, "eax"), 0x1234_5678);
  strictEqual(readStateU32(result.stateView, "eip"), 0x1002);
  strictEqual(readStateU32(result.stateView, "instructionCount"), 1);
  deepStrictEqual(result.exit, {
    exitReason: ExitReason.FALLTHROUGH,
    payload: 0x1002
  });
});

test("jit_mov_esp_ebp", async () => {
  const initialState = createCpuState({ esp: 0x10, ebp: 0x30, eip: startAddress });
  const result = await runCompiledBlock([0x8b, 0xe5], initialState);

  strictEqual(readStateU32(result.stateView, "esp"), 0x30);
  strictEqual(readStateU32(result.stateView, "ebp"), 0x30);
  strictEqual(readStateU32(result.stateView, "eip"), 0x1002);
  strictEqual(readStateU32(result.stateView, "instructionCount"), 1);
});

test("jit_mov_reg_reg_matches_interpreter", async () => {
  const fixtures: readonly MovRegFixture[] = [
    {
      bytes: [0x89, 0xc1],
      initialState: createCpuState({ eax: 0x1234_5678, ecx: 0, eip: startAddress })
    },
    {
      bytes: [0x8b, 0xe5],
      initialState: createCpuState({ esp: 0x10, ebp: 0x30, eip: startAddress })
    }
  ];

  for (const fixture of fixtures) {
    const instructions = decodeBytes(fixture.bytes);
    const interpreterState = createCpuState(fixture.initialState);
    const interpreterResult = runInstructionInterpreter(interpreterState, instructions);
    const wasmResult = await runCompiledBlock(fixture.bytes, fixture.initialState);

    strictEqual(interpreterResult.stopReason, StopReason.NONE);

    for (const field of stateFields) {
      strictEqual(readStateU32(wasmResult.stateView, field), interpreterState[field]);
    }
  }
});

type MovRegFixture = Readonly<{
  bytes: readonly number[];
  initialState: CpuState;
}>;
