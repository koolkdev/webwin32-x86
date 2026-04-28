import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason, type RunResult } from "../../src/core/execution/run-result.js";
import { cpuStatesEqual, type CpuState } from "../../src/core/state/cpu-state.js";
import { RuntimeInstance } from "../../src/runtime/instance/runtime-instance.js";
import { TierMode } from "../../src/runtime/tiering/tier-policy.js";
import { guestReader } from "../../src/test-support/decode-reader.js";
import { startAddress } from "../../src/test-support/x86-code.js";

const jumpOut = [0xeb, 0x00] as const;

test("wasm_lea_base_disp_matches_interpreter", () => {
  const fixture = [
    0x8d, 0x43, 0x10,
    ...jumpOut
  ] as const;
  const { t0, t1, t2 } = runAllTiers(fixture, { ebx: 0x100 });

  assertRuntimeMatches(t1, t0);
  assertRuntimeMatches(t2, t1);
  strictEqual(t2.result.stopReason, StopReason.NONE);
  strictEqual(t2.instance.state.eax, 0x110);
});

test("wasm_lea_sib_matches_interpreter", () => {
  const fixture = [
    0x8d, 0x44, 0x8b, 0x10,
    ...jumpOut
  ] as const;
  const { t0, t1, t2 } = runAllTiers(fixture, { ebx: 0x100, ecx: 3 });

  assertRuntimeMatches(t1, t0);
  assertRuntimeMatches(t2, t1);
  strictEqual(t2.instance.state.eax, 0x11c);
});

test("wasm_lea_absolute_disp_matches_interpreter", () => {
  const fixture = [
    0x8d, 0x05, 0x78, 0x56, 0x34, 0x12,
    ...jumpOut
  ] as const;
  const { t0, t1, t2 } = runAllTiers(fixture, { eax: 0xffff_ffff });

  assertRuntimeMatches(t1, t0);
  assertRuntimeMatches(t2, t1);
  strictEqual(t2.instance.state.eax, 0x1234_5678);
});

test("wasm_effective_address_wrap_matches_interpreter", () => {
  const fixture = [
    0x8d, 0x04, 0xcb,
    ...jumpOut
  ] as const;
  const { t0, t1, t2 } = runAllTiers(fixture, {
    ebx: 0xffff_fff0,
    ecx: 3,
    eflags: 0x8d5
  });

  assertRuntimeMatches(t1, t0);
  assertRuntimeMatches(t2, t1);
  strictEqual(t2.instance.state.eax, 8);
  strictEqual(t2.instance.state.eflags, 0x8d5);
});

test("t2_no_codegen_fallback_for_lea", () => {
  const fixture = [
    0x8d, 0x43, 0x10,
    0x8d, 0x54, 0x8b, 0x10,
    0x8d, 0x34, 0x8d, 0x00, 0x20, 0x40, 0x00,
    0x8d, 0x7c, 0xcb, 0xf0,
    0xcd, 0x2e
  ] as const;
  const t2 = runRuntime(fixture, TierMode.T2_ONLY, {
    ebx: 0xffff_fff0,
    ecx: 3
  });

  strictEqual(t2.result.stopReason, StopReason.HOST_TRAP);
  strictEqual(t2.instance.counters.profile.instructionsExecuted, 0);
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
    decodeReader: guestReader(bytes),
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
