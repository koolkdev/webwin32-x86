import { ok, strictEqual } from "node:assert";
import { test } from "node:test";

import type { DecodeReader } from "../../src/arch/x86/block-decoder/decode-reader.js";
import { StopReason, type RunResult } from "../../src/core/execution/run-result.js";
import { ArrayBufferGuestMemory, type GuestMemory } from "../../src/core/memory/guest-memory.js";
import { cpuStatesEqual, createCpuState, type CpuState } from "../../src/core/state/cpu-state.js";
import { DecodedBlockCache } from "../../src/runtime/decoded-block-cache/decoded-block-cache.js";
import { DecodedBlockRunner } from "../../src/runtime/decoded-block-runner/decoded-block-runner.js";
import { RuntimeInstance } from "../../src/runtime/instance/runtime-instance.js";
import { guestReader } from "../../src/test-support/decode-reader.js";
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
    decodeReader: guestReader(movAddFixture),
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
    memory: new ArrayBufferGuestMemory(0x40)
  });
  const runtime = new RuntimeInstance({
    decodeReader: guestReader(stackFixture),
    initialState: { eax: 0x1234_5678, esp: 0x40, eip: startAddress },
    guestMemoryByteLength: 0x40
  });
  const result = runtime.run();

  ok(cpuStatesEqual(runtime.state, expected.state));
  strictEqual(result.stopReason, expected.result.stopReason);
  strictEqual(runtime.state.ebx, 0x1234_5678);
});

test("runtime_instance_reuses_decoded_block_cache", () => {
  const runtime = new RuntimeInstance({
    decodeReader: guestReader(branchLoopFixture),
    initialState: { eax: 3, eip: startAddress }
  });

  runtime.run();

  strictEqual(runtime.counters.decodedBlockCache.hits, 2);
  strictEqual(runtime.counters.decodedBlockCache.misses, 2);
});

test("runtime_instance_exposes_final_state", () => {
  const runtime = new RuntimeInstance({
    decodeReader: guestReader(movAddFixture),
    initialState: { eip: startAddress }
  });
  const result = runtime.run();

  strictEqual(runtime.state.eax, 3);
  strictEqual(runtime.state.eip, result.finalEip);
  strictEqual(runtime.state.instructionCount, result.instructionCount);
  strictEqual(runtime.state.stopReason, result.stopReason);
});

test("runtime_instance_exposes_counters", () => {
  const runtime = new RuntimeInstance({
    decodeReader: guestReader(branchLoopFixture),
    initialState: { eax: 3, eip: startAddress }
  });

  runtime.run();

  strictEqual(runtime.counters.profile.instructionsExecuted, 10);
  strictEqual(runtime.counters.profile.blockHits.get(startAddress), 3);
  strictEqual(runtime.counters.profile.edgeHits.get(startAddress)?.get(startAddress), 2);
  strictEqual(runtime.counters.profile.edgeHits.get(startAddress)?.get(startAddress + 8), 1);
});

function runT1(
  bytes: readonly number[],
  initialState: Partial<CpuState>,
  options: Readonly<{ memory?: GuestMemory }> = {}
): Readonly<{ state: CpuState; result: RunResult }> {
  const state = createCpuState(initialState);
  const reader = guestReader(bytes);
  const runner = runnerFor(reader);
  const result =
    options.memory === undefined
      ? runner.run(state)
      : runner.run(state, { memory: options.memory });

  return { state, result };
}

function runnerFor(reader: DecodeReader): DecodedBlockRunner {
  return new DecodedBlockRunner(new DecodedBlockCache(reader));
}
