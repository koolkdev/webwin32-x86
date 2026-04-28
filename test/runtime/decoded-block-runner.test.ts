import { ok, strictEqual } from "node:assert";
import { performance } from "node:perf_hooks";
import { test } from "node:test";

import type { DecodeReader } from "../../src/arch/x86/block-decoder/decode-reader.js";
import { StopReason, type RunResult } from "../../src/core/execution/run-result.js";
import { cpuStatesEqual, createCpuState, type CpuState } from "../../src/core/state/cpu-state.js";
import { runInstructionInterpreter } from "../../src/interp/interpreter.js";
import { DecodedBlockCache, type DecodedBlockKey } from "../../src/runtime/decoded-block-cache/decoded-block-cache.js";
import { DecodedBlockRunner } from "../../src/runtime/decoded-block-runner/decoded-block-runner.js";
import { guestReader } from "../../src/test-support/decode-reader.js";
import { decodeBytes, startAddress } from "../../src/test-support/x86-code.js";

const movAddFixture = [
  0xb8, 0x01, 0x00, 0x00, 0x00,
  0x81, 0xc0, 0x02, 0x00, 0x00, 0x00,
  0xcd, 0x2e
] as const;

const branchLoopFixture = [
  0x83, 0xe8, 0x01,
  0x83, 0xf8, 0x00,
  0x75, 0xf8,
  0xcd, 0x2e
] as const;

test("block_engine_matches_mov_add_fixture", () => {
  const { interpreterState, interpreterResult, runnerState, runnerResult } = runBothEngines(movAddFixture);

  ok(cpuStatesEqual(runnerState, interpreterState));
  strictEqual(runnerResult.stopReason, interpreterResult.stopReason);
  strictEqual(runnerState.eax, 3);
  strictEqual(runnerState.stopReason, StopReason.HOST_TRAP);
});

test("block_engine_matches_branch_loop", () => {
  const { runner, interpreterState, interpreterResult, runnerState, runnerResult } = runBothEngines(branchLoopFixture, {
    eax: 3
  });

  ok(cpuStatesEqual(runnerState, interpreterState));
  strictEqual(runnerResult.stopReason, interpreterResult.stopReason);
  strictEqual(runnerState.eax, 0);
  strictEqual(runnerState.instructionCount, 10);
  strictEqual(runner.counters.instructionsExecuted, 10);
});

test("block_hits_recorded", () => {
  const reader = guestReader(branchLoopFixture);
  const state = createCpuState({ eax: 3, eip: startAddress });
  const runner = runnerFor(reader);

  runner.run(state);

  const loopBlockHits = runner.counters.blockHits.get(startAddress);

  ok(loopBlockHits !== undefined && loopBlockHits > 1);
});

test("edge_hits_recorded", () => {
  const reader = guestReader(branchLoopFixture);
  const state = createCpuState({ eax: 3, eip: startAddress });
  const runner = runnerFor(reader);
  const loopBlockKey = startAddress;
  const trapBlockKey = startAddress + 8;

  runner.run(state);

  strictEqual(edgeHits(runner, loopBlockKey, loopBlockKey), 2);
  strictEqual(edgeHits(runner, loopBlockKey, trapBlockKey), 1);
});

test("block_engine_timing_diagnostic", (t) => {
  const loops = 50;
  const interpreterState = createCpuState({ eax: loops, eip: startAddress });
  const runnerState = createCpuState({ eax: loops, eip: startAddress });
  const reader = guestReader(branchLoopFixture);
  const runner = runnerFor(reader);
  const instructions = decodeBytes(branchLoopFixture);

  const interpreterStart = performance.now();
  runInstructionInterpreter(interpreterState, instructions);
  const interpreterMs = performance.now() - interpreterStart;

  const runnerStart = performance.now();
  runner.run(runnerState);
  const runnerMs = performance.now() - runnerStart;

  ok(cpuStatesEqual(runnerState, interpreterState));
  t.diagnostic(`instruction interpreter: ${interpreterMs.toFixed(3)} ms`);
  t.diagnostic(`decoded-block runner: ${runnerMs.toFixed(3)} ms`);
});

function runBothEngines(
  bytes: readonly number[],
  initialState: Partial<CpuState> = {}
): Readonly<{
  runner: DecodedBlockRunner;
  interpreterState: CpuState;
  interpreterResult: RunResult;
  runnerState: CpuState;
  runnerResult: RunResult;
}> {
  const interpreterState = createCpuState({ ...initialState, eip: startAddress });
  const runnerState = createCpuState({ ...initialState, eip: startAddress });
  const reader = guestReader(bytes);
  const runner = runnerFor(reader);
  const interpreterResult = runInstructionInterpreter(interpreterState, decodeBytes(bytes));
  const runnerResult = runner.run(runnerState);

  return {
    runner,
    interpreterState,
    interpreterResult,
    runnerState,
    runnerResult
  };
}

function runnerFor(reader: DecodeReader): DecodedBlockRunner {
  return new DecodedBlockRunner(new DecodedBlockCache(reader));
}

function edgeHits(runner: DecodedBlockRunner, from: DecodedBlockKey, to: DecodedBlockKey): number | undefined {
  return runner.counters.edgeHits.get(from)?.get(to);
}
