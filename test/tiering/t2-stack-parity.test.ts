import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason, type RunResult } from "../../src/core/execution/run-result.js";
import { cpuStatesEqual, type CpuState } from "../../src/core/state/cpu-state.js";
import { RuntimeInstance } from "../../src/runtime/instance/runtime-instance.js";
import { TierMode } from "../../src/runtime/tiering/tier-policy.js";
import { fillGuestMemory, readGuestBytes, writeGuestBytes } from "../../src/test-support/guest-memory.js";
import { startAddress } from "../../src/test-support/x86-code.js";

type RuntimeRun = Readonly<{
  instance: RuntimeInstance;
  result: RunResult;
}>;

const hostTrap = [0xcd, 0x2e] as const;

test("wasm_push_pop_reg_matches_interpreter", () => {
  const fixture = [
    0x50,
    0x5b,
    ...hostTrap
  ] as const;
  const memoryRanges = [{ address: 0x3c, length: 4 }];
  const { t0, t1, t2 } = runAllTiers(fixture, {
    initialState: { eax: 0x1234_5678, esp: 0x40 }
  });

  assertRuntimeMatches(t1, t0, memoryRanges);
  assertRuntimeMatches(t2, t1, memoryRanges);
  strictEqual(t2.instance.state.ebx, 0x1234_5678);
  strictEqual(t2.instance.state.esp, 0x40);
});

test("wasm_push_imm_matches_interpreter", () => {
  const fixture = [
    0x68, 0x44, 0x33, 0x22, 0x11,
    0x6a, 0xff,
    ...hostTrap
  ] as const;
  const memoryRanges = [{ address: 0x38, length: 8 }];
  const { t0, t1, t2 } = runAllTiers(fixture, {
    initialState: { esp: 0x40 }
  });

  assertRuntimeMatches(t1, t0, memoryRanges);
  assertRuntimeMatches(t2, t1, memoryRanges);
  deepStrictEqual(readGuestBytes(t2.instance.guestMemory, 0x38, 8), [
    0xff, 0xff, 0xff, 0xff,
    0x44, 0x33, 0x22, 0x11
  ]);
});

test("wasm_pop_fault_matches_interpreter", () => {
  const fixture = [0x58] as const;
  const memoryRanges = [{ address: 0xfff8, length: 8 }];
  const { t0, t1, t2 } = runAllTiers(fixture, {
    initialState: { eax: 0x1234_5678, esp: 0xfffe, instructionCount: 7 },
    guestMemoryByteLength: 0x1_0000,
    fillMemory: 0xaa
  });

  assertRuntimeMatches(t1, t0, memoryRanges);
  assertRuntimeMatches(t2, t1, memoryRanges);
  strictEqual(t2.result.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(t2.result.faultOperation, "read");
});

test("wasm_push_fault_matches_interpreter", () => {
  const fixture = [0x50] as const;
  const memoryRanges = [{ address: 0xfff8, length: 8 }];
  const { t0, t1, t2 } = runAllTiers(fixture, {
    initialState: { eax: 0x1234_5678, esp: 0x1_0002, instructionCount: 7 },
    guestMemoryByteLength: 0x1_0000,
    fillMemory: 0xaa
  });

  assertRuntimeMatches(t1, t0, memoryRanges);
  assertRuntimeMatches(t2, t1, memoryRanges);
  strictEqual(t2.result.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(t2.result.faultOperation, "write");
});

test("t2_no_codegen_fallback_for_stack_ops", () => {
  const fixture = [
    0x50,
    0x68, 0x44, 0x33, 0x22, 0x11,
    0x6a, 0xff,
    0x5b,
    0x59,
    0x5a,
    0xcd, 0x2e
  ] as const;
  const t2 = runRuntime(fixture, TierMode.T2_ONLY, {
    initialState: { eax: 0x1234_5678, esp: 0x40 }
  });

  strictEqual(t2.result.stopReason, StopReason.HOST_TRAP);
  strictEqual(t2.instance.counters.profile.instructionsExecuted, 0);
  strictEqual(t2.instance.counters.wasmBlockCache.inserts, 1);
  strictEqual(t2.instance.counters.wasmBlockCache.unsupportedCodegenFallbacks, 0);
});

function runAllTiers(
  bytes: readonly number[],
  options: RunRuntimeOptions = {}
): Readonly<Record<"t0" | "t1" | "t2", RuntimeRun>> {
  return {
    t0: runRuntime(bytes, TierMode.T0_ONLY, options),
    t1: runRuntime(bytes, TierMode.T1_ONLY, options),
    t2: runRuntime(bytes, TierMode.T2_ONLY, options)
  };
}

function runRuntime(bytes: readonly number[], tierMode: TierMode, options: RunRuntimeOptions = {}): RuntimeRun {
  const instance = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes },
    initialState: { ...options.initialState, eip: startAddress },
    tierMode,
    ...(options.guestMemoryByteLength === undefined ? {} : { guestMemoryByteLength: options.guestMemoryByteLength })
  });

  if (options.fillMemory !== undefined) {
    fillGuestMemory(instance.guestMemory, options.fillMemory);
    writeGuestBytes(instance.guestMemory, startAddress, bytes);
  }

  return {
    instance,
    result: instance.run()
  };
}

function assertRuntimeMatches(
  actual: RuntimeRun,
  expected: RuntimeRun,
  memoryRanges: readonly MemoryRange[] = []
): void {
  deepStrictEqual(actual.result, expected.result);
  ok(cpuStatesEqual(actual.instance.state, expected.instance.state));

  for (const range of memoryRanges) {
    deepStrictEqual(
      readGuestBytes(actual.instance.guestMemory, range.address, range.length),
      readGuestBytes(expected.instance.guestMemory, range.address, range.length)
    );
  }
}

type RunRuntimeOptions = Readonly<{
  initialState?: Partial<CpuState>;
  guestMemoryByteLength?: number;
  fillMemory?: number;
}>;

type MemoryRange = Readonly<{
  address: number;
  length: number;
}>;
