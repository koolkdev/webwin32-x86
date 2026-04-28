import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason, type RunResult } from "../../src/core/execution/run-result.js";
import { cpuStatesEqual, getFlag, type CpuState } from "../../src/core/state/cpu-state.js";
import { RuntimeInstance } from "../../src/runtime/instance/runtime-instance.js";
import { TierMode } from "../../src/runtime/tiering/tier-policy.js";
import { guestReader } from "../../src/test-support/decode-reader.js";
import { fillGuestMemory, readGuestBytes, writeGuestU32 } from "../../src/test-support/guest-memory.js";
import { startAddress } from "../../src/test-support/x86-code.js";

type MemoryWrite = Readonly<{
  address: number;
  value: number;
}>;

type RuntimeRun = Readonly<{
  instance: RuntimeInstance;
  result: RunResult;
}>;

const jumpOut = [0xeb, 0x00] as const;

test("wasm_memory_add_load_matches_interpreter", () => {
  const fixture = [
    0x03, 0x05, 0x20, 0x00, 0x00, 0x00,
    ...jumpOut
  ] as const;
  const { t0, t1, t2 } = runAllTiers(fixture, {
    initialState: { eax: 0xffff_ffff },
    memoryWrites: [{ address: 0x20, value: 1 }]
  });

  assertRuntimeMatches(t1, t0, [{ address: 0x20, length: 4 }]);
  assertRuntimeMatches(t2, t1, [{ address: 0x20, length: 4 }]);
  strictEqual(t2.instance.state.eax, 0);
});

test("wasm_memory_add_store_matches_interpreter", () => {
  const fixture = [
    0x01, 0x18,
    ...jumpOut
  ] as const;
  const { t0, t1, t2 } = runAllTiers(fixture, {
    initialState: { eax: 0x20, ebx: 2 },
    memoryWrites: [{ address: 0x20, value: 1 }]
  });

  assertRuntimeMatches(t1, t0, [{ address: 0x20, length: 4 }]);
  assertRuntimeMatches(t2, t1, [{ address: 0x20, length: 4 }]);
  deepStrictEqual(readGuestBytes(t2.instance.guestMemory, 0x20, 4), [0x03, 0x00, 0x00, 0x00]);
});

test("wasm_memory_cmp_test_flags_match_interpreter", () => {
  const fixture = [
    0x39, 0x05, 0x20, 0x00, 0x00, 0x00,
    0x85, 0x1d, 0x24, 0x00, 0x00, 0x00,
    ...jumpOut
  ] as const;
  const memoryRanges = [
    { address: 0x20, length: 4 },
    { address: 0x24, length: 4 }
  ];
  const { t0, t1, t2 } = runAllTiers(fixture, {
    initialState: { eax: 5, ebx: 0x0f, eflags: 0xffff_0000 },
    memoryWrites: [
      { address: 0x20, value: 5 },
      { address: 0x24, value: 0xf0 }
    ]
  });

  assertRuntimeMatches(t1, t0, memoryRanges);
  assertRuntimeMatches(t2, t1, memoryRanges);
  strictEqual(getFlag(t2.instance.state, "ZF"), true);
  strictEqual(getFlag(t2.instance.state, "CF"), false);
  strictEqual(getFlag(t2.instance.state, "OF"), false);
});

test("wasm_memory_alu_immediate_matches_interpreter", () => {
  const fixture = [
    0x83, 0x05, 0x20, 0x00, 0x00, 0x00, 0xff,
    0x81, 0x3d, 0x24, 0x00, 0x00, 0x00, 0x34, 0x12, 0x00, 0x00,
    ...jumpOut
  ] as const;
  const memoryRanges = [
    { address: 0x20, length: 4 },
    { address: 0x24, length: 4 }
  ];
  const { t0, t1, t2 } = runAllTiers(fixture, {
    memoryWrites: [
      { address: 0x20, value: 3 },
      { address: 0x24, value: 0x1234 }
    ]
  });

  assertRuntimeMatches(t1, t0, memoryRanges);
  assertRuntimeMatches(t2, t1, memoryRanges);
  deepStrictEqual(readGuestBytes(t2.instance.guestMemory, 0x20, 4), [0x02, 0x00, 0x00, 0x00]);
});

test("wasm_memory_alu_fault_atomicity_matches_interpreter", () => {
  const fixture = [
    0x01, 0x05, 0xfe, 0xff, 0x00, 0x00
  ] as const;
  const memoryRanges = [{ address: 0xfff8, length: 8 }];
  const { t0, t1, t2 } = runAllTiers(fixture, {
    initialState: { eax: 5, eflags: 0x8d5, instructionCount: 7 },
    guestMemoryByteLength: 0x1_0000,
    fillMemory: 0xaa
  });

  assertRuntimeMatches(t1, t0, memoryRanges);
  assertRuntimeMatches(t2, t1, memoryRanges);
  strictEqual(t2.result.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(t2.result.faultAddress, 0xfffe);
  strictEqual(t2.result.faultSize, 4);
  strictEqual(t2.result.faultOperation, "read");
});

test("t2_no_codegen_fallback_for_memory_alu", () => {
  const fixture = [
    0x03, 0x05, 0x20, 0x00, 0x00, 0x00,
    0x01, 0x18,
    0x39, 0x05, 0x24, 0x00, 0x00, 0x00,
    0x85, 0x1d, 0x28, 0x00, 0x00, 0x00,
    0x83, 0x05, 0x2c, 0x00, 0x00, 0x00, 0xff,
    0xcd, 0x2e
  ] as const;
  const t2 = runRuntime(fixture, TierMode.T2_ONLY, {
    initialState: { eax: 0x20, ebx: 2 },
    memoryWrites: [
      { address: 0x20, value: 1 },
      { address: 0x24, value: 0x23 },
      { address: 0x28, value: 0xf0 },
      { address: 0x2c, value: 3 }
    ]
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
  const runtimeOptions = {
    decodeReader: guestReader(bytes),
    initialState: { ...options.initialState, eip: startAddress },
    tierMode
  };
  const instance = new RuntimeInstance({
    ...runtimeOptions,
    ...(options.guestMemoryByteLength === undefined ? {} : { guestMemoryByteLength: options.guestMemoryByteLength })
  });

  if (options.fillMemory !== undefined) {
    fillGuestMemory(instance.guestMemory, options.fillMemory);
  }

  for (const write of options.memoryWrites ?? []) {
    writeGuestU32(instance.guestMemory, write.address, write.value);
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
  memoryWrites?: readonly MemoryWrite[];
  guestMemoryByteLength?: number;
  fillMemory?: number;
}>;

type MemoryRange = Readonly<{
  address: number;
  length: number;
}>;
