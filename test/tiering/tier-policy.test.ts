import { ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason, type RunResult } from "../../src/core/execution/run-result.js";
import { cpuStatesEqual, createCpuState, type CpuState } from "../../src/core/state/cpu-state.js";
import { DecodedBlockCache } from "../../src/runtime/decoded-block-cache/decoded-block-cache.js";
import { DecodedBlockRunner } from "../../src/runtime/decoded-block-runner/decoded-block-runner.js";
import { RuntimeInstance } from "../../src/runtime/instance/runtime-instance.js";
import { TierMode } from "../../src/runtime/tiering/tier-policy.js";
import { guestReader } from "../../src/test-support/decode-reader.js";
import { startAddress } from "../../src/test-support/x86-code.js";

const branchLoopFixture = [
  0x83, 0xe8, 0x01,
  0x83, 0xf8, 0x00,
  0x75, 0xf8,
  0xcd, 0x2e
] as const;

const movAddFixture = [
  0xb8, 0x01, 0x00, 0x00, 0x00,
  0x81, 0xc0, 0x02, 0x00, 0x00, 0x00,
  0xcd, 0x2e
] as const;

test("t0_only_uses_instruction_interpreter", () => {
  const expected = runT1(branchLoopFixture, { eax: 3, eip: startAddress });
  const runtime = new RuntimeInstance({
    decodeReader: guestReader(branchLoopFixture),
    initialState: { eax: 3, eip: startAddress },
    tierMode: TierMode.T0_ONLY
  });
  const result = runtime.run();

  ok(cpuStatesEqual(runtime.state, expected.state));
  strictEqual(result.stopReason, expected.result.stopReason);
  strictEqual(runtime.state.instructionCount, 10);
  strictEqual(runtime.counters.decodedBlockCache.hits, 0);
  strictEqual(runtime.counters.decodedBlockCache.misses, 0);
  strictEqual(runtime.counters.profile.instructionsExecuted, 0);
});

test("t1_only_uses_decoded_block_engine", () => {
  const runtime = new RuntimeInstance({
    decodeReader: guestReader(branchLoopFixture),
    initialState: { eax: 3, eip: startAddress },
    tierMode: TierMode.T1_ONLY
  });
  const result = runtime.run();

  strictEqual(result.stopReason, StopReason.HOST_TRAP);
  strictEqual(runtime.state.instructionCount, 10);
  strictEqual(runtime.counters.decodedBlockCache.hits, 2);
  strictEqual(runtime.counters.decodedBlockCache.misses, 2);
  strictEqual(runtime.counters.profile.instructionsExecuted, 10);
});

test("tier_policy_visible_to_metrics_adapter", () => {
  const t0Runtime = new RuntimeInstance({
    decodeReader: guestReader(movAddFixture),
    initialState: { eip: startAddress },
    tierMode: TierMode.T0_ONLY
  });
  const t1Runtime = new RuntimeInstance({
    decodeReader: guestReader(movAddFixture),
    initialState: { eip: startAddress },
    tierMode: TierMode.T1_ONLY
  });

  strictEqual(t0Runtime.tierMode, TierMode.T0_ONLY);
  strictEqual(t1Runtime.tierMode, TierMode.T1_ONLY);
});

function runT1(
  bytes: readonly number[],
  initialState: Partial<CpuState>
): Readonly<{ state: CpuState; result: RunResult }> {
  const state = createCpuState(initialState);
  const cache = new DecodedBlockCache(guestReader(bytes));
  const runner = new DecodedBlockRunner(cache);
  const result = runner.run(state);

  return { state, result };
}
