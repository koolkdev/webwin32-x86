import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason, type RunResult } from "../../src/core/execution/run-result.js";
import { cpuStatesEqual, getFlag, type CpuState } from "../../src/core/state/cpu-state.js";
import { RuntimeInstance } from "../../src/runtime/instance/runtime-instance.js";
import { TierMode } from "../../src/runtime/tiering/tier-policy.js";
import { fillGuestMemory, readGuestBytes, writeGuestBytes, writeGuestU32 } from "../../src/test-support/guest-memory.js";
import { startAddress } from "../../src/test-support/x86-code.js";

test("t2_parity_register_arithmetic", () => {
  const fixture = [
    0xb8, 0xff, 0xff, 0xff, 0xff,
    0xbb, 0x01, 0x00, 0x00, 0x00,
    0x01, 0xd8,
    0x31, 0xdb,
    0x29, 0xd8,
    0x39, 0xd8,
    0x85, 0xd8,
    0xcd, 0x2e
  ] as const;
  const { t0, t1, t2 } = runAllTiers(fixture, {
    initialState: { eflags: 0xffff_0000 }
  });

  assertRuntimeMatches(t1, t0);
  assertRuntimeMatches(t2, t1);
  assertNoT2Fallback(t2);
  strictEqual(t2.result.stopReason, StopReason.HOST_TRAP);
  strictEqual(getFlag(t2.instance.state, "ZF"), true);
});

test("t2_parity_memory_load_store", () => {
  const fixture = [
    0x89, 0x05, 0x20, 0x00, 0x00, 0x00,
    0x8b, 0x1d, 0x20, 0x00, 0x00, 0x00,
    0xcd, 0x2e
  ] as const;
  const memoryRanges = [{ address: 0x20, length: 4 }];
  const { t0, t1, t2 } = runAllTiers(fixture, {
    initialState: { eax: 0x1234_5678 }
  });

  assertRuntimeMatches(t1, t0, memoryRanges);
  assertRuntimeMatches(t2, t1, memoryRanges);
  assertNoT2Fallback(t2);
  strictEqual(t2.instance.state.ebx, 0x1234_5678);
  deepStrictEqual(readGuestBytes(t2.instance.guestMemory, 0x20, 4), [0x78, 0x56, 0x34, 0x12]);
});

test("t2_parity_memory_alu", () => {
  const fixture = [
    0x03, 0x05, 0x20, 0x00, 0x00, 0x00,
    0x01, 0x1d, 0x24, 0x00, 0x00, 0x00,
    0x83, 0x05, 0x28, 0x00, 0x00, 0x00, 0xff,
    0x39, 0x1d, 0x20, 0x00, 0x00, 0x00,
    0x85, 0x05, 0x28, 0x00, 0x00, 0x00,
    0xcd, 0x2e
  ] as const;
  const memoryRanges = [
    { address: 0x20, length: 4 },
    { address: 0x24, length: 4 },
    { address: 0x28, length: 4 }
  ];
  const { t0, t1, t2 } = runAllTiers(fixture, {
    initialState: { eax: 5, ebx: 2, eflags: 0xffff_0000 },
    memoryWrites: [
      { address: 0x20, value: 7 },
      { address: 0x24, value: 1 },
      { address: 0x28, value: 3 }
    ]
  });

  assertRuntimeMatches(t1, t0, memoryRanges);
  assertRuntimeMatches(t2, t1, memoryRanges);
  assertNoT2Fallback(t2);
  strictEqual(t2.instance.state.eax, 12);
  deepStrictEqual(readGuestBytes(t2.instance.guestMemory, 0x24, 4), [0x03, 0x00, 0x00, 0x00]);
  deepStrictEqual(readGuestBytes(t2.instance.guestMemory, 0x28, 4), [0x02, 0x00, 0x00, 0x00]);
});

test("t2_parity_control_flow", () => {
  const fixture = [
    0xb8, 0x03, 0x00, 0x00, 0x00,
    0x83, 0xe8, 0x01,
    0x83, 0xf8, 0x00,
    0x75, 0xf8,
    0xcd, 0x2e
  ] as const;
  const { t0, t1, t2 } = runAllTiers(fixture);

  assertRuntimeMatches(t1, t0);
  assertRuntimeMatches(t2, t1);
  assertNoT2Fallback(t2);
  strictEqual(t2.result.stopReason, StopReason.HOST_TRAP);
  strictEqual(t2.instance.state.eax, 0);
  strictEqual(t2.instance.state.instructionCount, 11);
});

test("t2_parity_stack_and_call", () => {
  const fixture = [
    0x50,
    0x5b,
    0xe8, 0x02, 0x00, 0x00, 0x00,
    0xcd, 0x2e,
    0xb9, 0x44, 0x33, 0x22, 0x11,
    0xc3
  ] as const;
  const memoryRanges = [{ address: 0x3c, length: 4 }];
  const { t0, t1, t2 } = runAllTiers(fixture, {
    initialState: { eax: 0x1234_5678, esp: 0x40 }
  });

  assertRuntimeMatches(t1, t0, memoryRanges);
  assertRuntimeMatches(t2, t1, memoryRanges);
  assertNoT2Fallback(t2);
  strictEqual(t2.result.stopReason, StopReason.HOST_TRAP);
  strictEqual(t2.instance.state.ebx, 0x1234_5678);
  strictEqual(t2.instance.state.ecx, 0x1122_3344);
  strictEqual(t2.instance.state.esp, 0x40);
});

test("t2_parity_faults_and_guest_stops", () => {
  const memoryFault = runAllTiers([0x8b, 0x05, 0xfe, 0xff, 0x00, 0x00, 0xcd, 0x2e], {
    guestMemoryByteLength: 0x1_0000,
    fillMemory: 0xaa,
    initialState: { eax: 0x1234_5678, instructionCount: 7 }
  });

  assertRuntimeMatches(memoryFault.t1, memoryFault.t0, [{ address: 0xfff8, length: 8 }]);
  assertRuntimeMatches(memoryFault.t2, memoryFault.t1, [{ address: 0xfff8, length: 8 }]);
  assertNoT2Fallback(memoryFault.t2);
  strictEqual(memoryFault.t2.result.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(memoryFault.t2.result.faultAddress, 0xfffe);
  strictEqual(memoryFault.t2.result.faultOperation, "read");

  const unsupported = runAllTiers([0x62]);

  assertRuntimeMatches(unsupported.t1, unsupported.t0);
  assertRuntimeMatches(unsupported.t2, unsupported.t1);
  strictEqual(unsupported.t2.result.stopReason, StopReason.UNSUPPORTED);
  strictEqual(unsupported.t2.result.unsupportedByte, 0x62);
  strictEqual(unsupported.t2.instance.counters.wasmBlockCache.unsupportedCodegenFallbacks, 1);

  const decodeFault = runAllTiers([]);

  assertRuntimeMatches(decodeFault.t1, decodeFault.t0);
  assertRuntimeMatches(decodeFault.t2, decodeFault.t1);
  strictEqual(decodeFault.t2.result.stopReason, StopReason.DECODE_FAULT);
  strictEqual(decodeFault.t2.result.faultAddress, startAddress);
  strictEqual(decodeFault.t2.result.faultOperation, "execute");
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

function runRuntime(
  bytes: readonly number[],
  tierMode: TierMode,
  options: RunRuntimeOptions = {}
): RuntimeRun {
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

function assertNoT2Fallback(run: RuntimeRun): void {
  strictEqual(run.instance.counters.profile.instructionsExecuted, 0);
  strictEqual(run.instance.counters.wasmBlockCache.unsupportedCodegenFallbacks, 0);
}

type RunRuntimeOptions = Readonly<{
  initialState?: Partial<CpuState>;
  memoryWrites?: readonly MemoryWrite[];
  guestMemoryByteLength?: number;
  fillMemory?: number;
}>;

type RuntimeRun = Readonly<{
  instance: RuntimeInstance;
  result: RunResult;
}>;

type MemoryWrite = Readonly<{
  address: number;
  value: number;
}>;

type MemoryRange = Readonly<{
  address: number;
  length: number;
}>;
