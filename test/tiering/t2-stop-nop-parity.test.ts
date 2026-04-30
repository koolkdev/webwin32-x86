import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason, type RunResult } from "../../src/core/execution/run-result.js";
import { cpuStatesEqual, type CpuState } from "../../src/core/state/cpu-state.js";
import { RuntimeInstance } from "../../src/runtime/instance/runtime-instance.js";
import { TierMode } from "../../src/runtime/tiering/tier-policy.js";
import { startAddress } from "../../src/test-support/x86-code.js";

const nopFixture = [
  0x90,
  0x90,
  0xcd, 0x2e
] as const;

const intFixture = [
  0x90,
  0xcd, 0x2e
] as const;

test("wasm_nop_matches_interpreter", () => {
  const { t0, t1, t2 } = runAllTiers(nopFixture);

  assertRuntimeMatches(t1, t0);
  assertRuntimeMatches(t2, t1);
  strictEqual(t2.result.stopReason, StopReason.HOST_TRAP);
  strictEqual(t2.instance.state.eip, startAddress + 4);
  strictEqual(t2.instance.state.instructionCount, 3);
});

test("wasm_int_trap_matches_interpreter", () => {
  const { t0, t1, t2 } = runAllTiers(intFixture);

  assertRuntimeMatches(t1, t0);
  assertRuntimeMatches(t2, t1);
  strictEqual(t2.result.stopReason, StopReason.HOST_TRAP);
  strictEqual(t2.result.trapVector, 0x2e);
  strictEqual(t2.instance.state.eip, startAddress + 3);
  strictEqual(t2.instance.state.instructionCount, 2);
});

test("t2_no_codegen_fallback_for_nop_int", () => {
  const t2 = runRuntime(intFixture, TierMode.T2_ONLY);

  strictEqual(t2.result.stopReason, StopReason.HOST_TRAP);
  strictEqual(t2.instance.counters.wasmBlockCache.inserts, 1);
  strictEqual(t2.instance.counters.wasmBlockCache.unsupportedCodegenFallbacks, 0);
});

function runAllTiers(
  bytes: readonly number[],
  initialState: Partial<CpuState> = {}
): Readonly<Record<"t0" | "t1" | "t2", RuntimeRun>> {
  return {
    t0: runRuntime(bytes, TierMode.T0_ONLY, initialState),
    t1: runRuntime(bytes, TierMode.T1_ONLY, initialState),
    t2: runRuntime(bytes, TierMode.T2_ONLY, initialState)
  };
}

function runRuntime(
  bytes: readonly number[],
  tierMode: TierMode,
  initialState: Partial<CpuState> = {}
): RuntimeRun {
  const instance = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes },
    initialState: { ...initialState, eip: startAddress },
    tierMode
  });

  return {
    instance,
    result: instance.run()
  };
}

function assertRuntimeMatches(actual: RuntimeRun, expected: RuntimeRun): void {
  deepStrictEqual(actual.result, expected.result);
  ok(cpuStatesEqual(actual.instance.state, expected.instance.state));
}

type RuntimeRun = Readonly<{
  instance: RuntimeInstance;
  result: RunResult;
}>;
