import { ok, strictEqual, throws } from "node:assert";
import { test } from "node:test";

import { StopReason, type RunResult } from "../../src/core/execution/run-result.js";
import { ArrayBufferGuestMemory } from "../../src/core/memory/guest-memory.js";
import { cpuStatesEqual, type CpuState } from "../../src/core/state/cpu-state.js";
import { RuntimeInstance } from "../../src/runtime/instance/runtime-instance.js";
import { TierMode } from "../../src/runtime/tiering/tier-policy.js";
import { startAddress } from "../../src/test-support/x86-code.js";

const supportedJumpFixture = [
  0xb8, 0x01, 0x00, 0x00, 0x00,
  0x81, 0xc0, 0x02, 0x00, 0x00, 0x00,
  0xeb, 0x00
] as const;

const unsupportedX86Fixture = [
  0x62
] as const;

const branchLoopFixture = [
  0x83, 0xe8, 0x01,
  0x83, 0xf8, 0x00,
  0x75, 0xf8,
  0xcd, 0x2e
] as const;

const straightLineTrapFixture = [
  ...Array.from({ length: 80 }, () => 0x90),
  0xcd, 0x2e
] as const;

test("supported_block_runs_as_t2", () => {
  const runtime = runRuntime(supportedJumpFixture, TierMode.T2_ONLY);

  strictEqual(runtime.result.stopReason, StopReason.NONE);
  strictEqual(runtime.instance.state.eax, 3);
  strictEqual(runtime.instance.state.instructionCount, 3);
  strictEqual(runtime.instance.counters.decodedBlockCache.misses, 0);
  strictEqual(runtime.instance.counters.profile.instructionsExecuted, 0);
  strictEqual(runtime.instance.counters.wasmBlockCache.inserts, 1);
  strictEqual(runtime.instance.counters.wasmBlockCache.hits, 0);
});

test("wasm_block_cache_reuses_supported_block", () => {
  const runtime = runRuntime(branchLoopFixture, TierMode.T2_ONLY, { eax: 3 });

  strictEqual(runtime.result.stopReason, StopReason.HOST_TRAP);
  strictEqual(runtime.instance.counters.wasmBlockCache.inserts, 2);
  strictEqual(runtime.instance.counters.wasmBlockCache.hits, 2);
  strictEqual(runtime.instance.counters.wasmBlockCache.unsupportedCodegenFallbacks, 0);
});

test("t2_default_block_limit_keeps_medium_straight_line_code_in_one_block", () => {
  const runtime = runRuntime(straightLineTrapFixture, TierMode.T2_ONLY);

  strictEqual(runtime.result.stopReason, StopReason.HOST_TRAP);
  strictEqual(runtime.instance.state.instructionCount, 81);
  strictEqual(runtime.instance.counters.wasmBlockCache.inserts, 1);
  strictEqual(runtime.instance.counters.wasmBlockCache.hits, 0);
});

test("t2_block_limit_can_be_configured_for_smaller_blocks", () => {
  const runtime = runRuntime(straightLineTrapFixture, TierMode.T2_ONLY, {}, {
    t2MaxInstructionsPerBlock: 16
  });

  strictEqual(runtime.result.stopReason, StopReason.HOST_TRAP);
  strictEqual(runtime.instance.state.instructionCount, 81);
  strictEqual(runtime.instance.counters.wasmBlockCache.inserts, 6);
  strictEqual(runtime.instance.counters.wasmBlockCache.hits, 0);
});

test("t2_block_limit_rejects_non_positive_values", () => {
  throws(
    () => new RuntimeInstance({
      program: { baseAddress: startAddress, bytes: supportedJumpFixture },
      initialState: { eip: startAddress },
      tierMode: TierMode.T2_ONLY,
      t2MaxInstructionsPerBlock: 0
    }),
    /maxInstructionsPerBlock must be a positive integer/
  );
});

test("wasm_block_cache_clear_forces_recompile", () => {
  const runtime = runRuntime(supportedJumpFixture, TierMode.T2_ONLY);

  strictEqual(runtime.result.stopReason, StopReason.NONE);
  strictEqual(runtime.instance.counters.wasmBlockCache.misses, 1);
  strictEqual(runtime.instance.counters.wasmBlockCache.inserts, 1);

  runtime.instance.clearWasmBlockCache();
  runtime.instance.run({ entryEip: startAddress });

  strictEqual(runtime.instance.counters.wasmBlockCache.hits, 0);
  strictEqual(runtime.instance.counters.wasmBlockCache.misses, 2);
  strictEqual(runtime.instance.counters.wasmBlockCache.inserts, 2);
});

test("unsupported_x86_fallback_uses_t1_without_wasm_miss_cache", () => {
  const runtime = runRuntime(unsupportedX86Fixture, TierMode.T2_ONLY);

  strictEqual(runtime.result.stopReason, StopReason.UNSUPPORTED);

  runtime.instance.run({ entryEip: startAddress });

  strictEqual(runtime.instance.counters.wasmBlockCache.hits, 0);
  strictEqual(runtime.instance.counters.wasmBlockCache.misses, 2);
  strictEqual(runtime.instance.counters.wasmBlockCache.inserts, 0);
  strictEqual(runtime.instance.counters.wasmBlockCache.unsupportedCodegenFallbacks, 2);
});

test("wasm_block_cache_counters_visible", () => {
  const runtime = runRuntime(branchLoopFixture, TierMode.T2_ONLY, { eax: 3 });

  strictEqual(runtime.instance.counters.wasmBlockCache.hits, 2);
  strictEqual(runtime.instance.counters.wasmBlockCache.misses, 2);
  strictEqual(runtime.instance.counters.wasmBlockCache.inserts, 2);
  strictEqual(runtime.instance.counters.wasmBlockCache.unsupportedCodegenFallbacks, 0);
});

test("unsupported_x86_still_stops_as_guest_unsupported", () => {
  const runtime = runRuntime(unsupportedX86Fixture, TierMode.T2_ONLY);

  strictEqual(runtime.result.stopReason, StopReason.UNSUPPORTED);
  strictEqual(runtime.result.unsupportedByte, 0x62);
  strictEqual(runtime.instance.state.instructionCount, 0);
  strictEqual(runtime.instance.counters.profile.instructionsExecuted, 0);
  strictEqual(runtime.instance.counters.wasmBlockCache.inserts, 0);
  strictEqual(runtime.instance.counters.wasmBlockCache.unsupportedCodegenFallbacks, 1);
});

test("decode_fault_still_stops_as_decode_fault", () => {
  const runtime = new RuntimeInstance({
    initialState: { eip: startAddress },
    tierMode: TierMode.T2_ONLY
  });
  const result = runtime.run();

  strictEqual(result.stopReason, StopReason.DECODE_FAULT);
  strictEqual(result.faultAddress, startAddress);
  strictEqual(result.faultOperation, "execute");
});

test("t2_requires_wasm_shareable_guest_memory", () => {
  throws(
    () => new RuntimeInstance({
      program: { baseAddress: startAddress, bytes: supportedJumpFixture },
      guestMemory: new ArrayBufferGuestMemory(0x1_0000),
      tierMode: TierMode.T2_ONLY
    }),
    /runtime-owned WebAssembly guest memory/
  );
});

test("t2_rounds_guest_memory_size_to_wasm_page", () => {
  const runtime = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes: supportedJumpFixture },
    initialState: { eip: startAddress },
    guestMemoryByteLength: 0x40,
    tierMode: TierMode.T2_ONLY
  });
  const result = runtime.run();

  strictEqual(result.stopReason, StopReason.NONE);
  ok(runtime.guestMemory.byteLength >= 0x40);
});

test("t2_fallback_final_state_matches_t1", () => {
  const t1 = runRuntime(branchLoopFixture, TierMode.T1_ONLY, { eax: 3 });
  const t2 = runRuntime(branchLoopFixture, TierMode.T2_ONLY, { eax: 3 });

  ok(cpuStatesEqual(t2.instance.state, t1.instance.state));
  strictEqual(t2.result.stopReason, t1.result.stopReason);
  strictEqual(t2.instance.state.instructionCount, 10);
});

function runRuntime(
  bytes: readonly number[],
  tierMode: TierMode,
  initialState: Partial<CpuState> = {},
  options: Readonly<{
    t2MaxInstructionsPerBlock?: number;
  }> = {}
): Readonly<{ instance: RuntimeInstance; result: RunResult }> {
  const instance = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes },
    initialState: { ...initialState, eip: startAddress },
    tierMode,
    ...options
  });
  const result = instance.run();

  return { instance, result };
}
