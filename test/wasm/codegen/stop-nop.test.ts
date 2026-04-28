import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason } from "../../../src/core/execution/run-result.js";
import { cloneCpuState, createCpuState } from "../../../src/core/state/cpu-state.js";
import { runInstructionInterpreter } from "../../../src/interp/interpreter.js";
import {
  assertWasmMatchesInterpreter,
  compileAndRunBlock,
  decodeBytes,
  readStateU32,
  startAddress
} from "../../../src/test-support/wasm-codegen.js";
import { ExitReason } from "../../../src/wasm/exit.js";

test("jit_nop_matches_interpreter", async () => {
  const { wasmResult } = await assertWasmMatchesInterpreter(
    [0x90, 0x90],
    createCpuState({ eip: startAddress, instructionCount: 7 })
  );

  strictEqual(readStateU32(wasmResult.stateView, "eip"), startAddress + 2);
  strictEqual(readStateU32(wasmResult.stateView, "instructionCount"), 9);
});

test("jit_int_returns_host_trap_exit", async () => {
  const initialState = createCpuState({ eip: startAddress, instructionCount: 7 });
  const interpreterState = cloneCpuState(initialState);
  const interpreterResult = runInstructionInterpreter(interpreterState, decodeBytes([0xcd, 0x2e]));
  const wasmResult = await compileAndRunBlock([0xcd, 0x2e], initialState);

  strictEqual(interpreterResult.stopReason, StopReason.HOST_TRAP);
  strictEqual(interpreterResult.trapVector, 0x2e);
  strictEqual(readStateU32(wasmResult.stateView, "eip"), interpreterState.eip);
  strictEqual(readStateU32(wasmResult.stateView, "instructionCount"), interpreterState.instructionCount);
  deepStrictEqual(wasmResult.exit, {
    exitReason: ExitReason.HOST_TRAP,
    payload: 0x2e
  });
});
