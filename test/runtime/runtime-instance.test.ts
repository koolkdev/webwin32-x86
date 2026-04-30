import { ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason, type RunResult } from "../../src/core/execution/run-result.js";
import { cpuStatesEqual, createCpuState, type CpuState } from "../../src/core/state/cpu-state.js";
import { RuntimeInstance } from "../../src/runtime/instance/runtime-instance.js";
import { TierMode } from "../../src/runtime/tiering/tier-policy.js";
import { startAddress } from "../../src/test-support/x86-code.js";

const movAddFixture = [
  0xb8, 0x01, 0x00, 0x00, 0x00,
  0x81, 0xc0, 0x02, 0x00, 0x00, 0x00,
  0xcd, 0x2e
] as const;

const stackFixture = [
  0x50,
  0x5b,
  0xcd, 0x2e
] as const;

const branchLoopFixture = [
  0x83, 0xe8, 0x01,
  0x83, 0xf8, 0x00,
  0x75, 0xf8,
  0xcd, 0x2e
] as const;

test("runtime_instance_runs_simple_fixture", () => {
  const expected = runT1(movAddFixture, { eip: startAddress });
  const runtime = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes: movAddFixture },
    initialState: { eip: startAddress }
  });
  const result = runtime.run();

  ok(cpuStatesEqual(runtime.state, expected.state));
  strictEqual(result.stopReason, expected.result.stopReason);
  strictEqual(runtime.state.eax, 3);
  strictEqual(runtime.state.stopReason, StopReason.HOST_TRAP);
});

test("runtime_instance_uses_owned_guest_memory", () => {
  const expected = runT1(stackFixture, { eax: 0x1234_5678, esp: 0x40, eip: startAddress }, {
    guestMemoryByteLength: 0x40
  });
  const runtime = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes: stackFixture },
    initialState: { eax: 0x1234_5678, esp: 0x40, eip: startAddress },
    guestMemoryByteLength: 0x40
  });
  const result = runtime.run();

  ok(cpuStatesEqual(runtime.state, expected.state));
  strictEqual(result.stopReason, expected.result.stopReason);
  strictEqual(runtime.state.ebx, 0x1234_5678);
});

test("runtime_instance_t1_does_not_use_wasm_block_cache", () => {
  const runtime = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes: branchLoopFixture },
    initialState: { eax: 3, eip: startAddress }
  });

  runtime.run();

  strictEqual(runtime.counters.wasmBlockCache.hits, 0);
  strictEqual(runtime.counters.wasmBlockCache.misses, 0);
  strictEqual(runtime.counters.wasmBlockCache.inserts, 0);
});

test("runtime_instance_exposes_final_state", () => {
  const runtime = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes: movAddFixture },
    initialState: { eip: startAddress }
  });
  const result = runtime.run();

  strictEqual(runtime.state.eax, 3);
  strictEqual(runtime.state.eip, result.finalEip);
  strictEqual(runtime.state.instructionCount, result.instructionCount);
  strictEqual(runtime.state.stopReason, result.stopReason);
});

test("runtime_instance_exposes_wasm_counters", () => {
  const runtime = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes: branchLoopFixture },
    initialState: { eax: 3, eip: startAddress },
    tierMode: TierMode.T2_ONLY
  });

  runtime.run();

  strictEqual(runtime.counters.wasmBlockCache.inserts, 2);
  strictEqual(runtime.counters.wasmBlockCache.hits, 2);
});

function runT1(
  bytes: readonly number[],
  initialState: Partial<CpuState>,
  options: Readonly<{ guestMemoryByteLength?: number }> = {}
): Readonly<{ state: CpuState; result: RunResult }> {
  const runtime = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes },
    initialState,
    tierMode: TierMode.T1_ONLY,
    ...(options.guestMemoryByteLength === undefined ? {} : { guestMemoryByteLength: options.guestMemoryByteLength })
  });
  const result = runtime.run();

  return { state: createCpuState(runtime.state), result };
}
