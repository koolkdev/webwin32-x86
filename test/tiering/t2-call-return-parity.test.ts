import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason, type RunResult } from "../../src/core/execution/run-result.js";
import { cpuStatesEqual, type CpuState } from "../../src/core/state/cpu-state.js";
import { RuntimeInstance } from "../../src/runtime/instance/runtime-instance.js";
import { TierMode } from "../../src/runtime/tiering/tier-policy.js";
import { fillGuestMemory, readGuestBytes, writeGuestBytes, writeGuestU32 } from "../../src/test-support/guest-memory.js";
import { startAddress } from "../../src/test-support/x86-code.js";

type RuntimeRun = Readonly<{
  instance: RuntimeInstance;
  result: RunResult;
}>;

test("wasm_call_ret_matches_interpreter", () => {
  const fixture = [
    0xe8, 0x02, 0x00, 0x00, 0x00,
    0xeb, 0x06,
    0xb8, 0x78, 0x56, 0x34, 0x12,
    0xc3,
    0xcd, 0x2e
  ] as const;
  const { t0, t1, t2 } = runAllTiers(fixture, {
    initialState: { esp: 0x40 }
  });

  assertRuntimeMatches(t1, t0, [{ address: 0x3c, length: 4 }]);
  assertRuntimeMatches(t2, t1, [{ address: 0x3c, length: 4 }]);
  strictEqual(t2.instance.state.eax, 0x1234_5678);
  strictEqual(t2.instance.state.esp, 0x40);
  strictEqual(t2.instance.state.eip, 0x100f);
});

test("wasm_call_pushes_return_address", () => {
  const fixture = [
    0xe8, 0x0b, 0x00, 0x00, 0x00,
    0x90, 0x90, 0x90, 0x90,
    0x90, 0x90, 0x90, 0x90,
    0x90, 0x90, 0x90,
    0xcd, 0x2e
  ] as const;
  const { t0, t1, t2 } = runAllTiers(fixture, {
    initialState: { esp: 0x40 }
  });

  assertRuntimeMatches(t1, t0, [{ address: 0x3c, length: 4 }]);
  assertRuntimeMatches(t2, t1, [{ address: 0x3c, length: 4 }]);
  deepStrictEqual(readGuestBytes(t2.instance.guestMemory, 0x3c, 4), [0x05, 0x10, 0x00, 0x00]);
});

test("wasm_ret_pops_eip", () => {
  const fixture = [0xc3, 0xcd, 0x2e] as const;
  const { t0, t1, t2 } = runAllTiers(fixture, {
    initialState: { esp: 0x20 },
    memoryWrites: [{ address: 0x20, value: startAddress + 1 }]
  });

  assertRuntimeMatches(t1, t0);
  assertRuntimeMatches(t2, t1);
  strictEqual(t2.instance.state.eip, startAddress + 3);
  strictEqual(t2.instance.state.esp, 0x24);
});

test("wasm_call_fault_matches_interpreter", () => {
  const fixture = [0xe8, 0x0b, 0x00, 0x00, 0x00] as const;
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

test("wasm_ret_fault_matches_interpreter", () => {
  const fixture = [0xc3] as const;
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

test("t2_no_codegen_fallback_for_call_ret", () => {
  const fixture = [
    0xe8, 0x02, 0x00, 0x00, 0x00,
    0xcd, 0x2e,
    0x90,
    0xc3
  ] as const;
  const t2 = runRuntime(fixture, TierMode.T2_ONLY, {
    initialState: { esp: 0x40 }
  });

  strictEqual(t2.result.stopReason, StopReason.HOST_TRAP);
  strictEqual(t2.instance.counters.profile.instructionsExecuted, 0);
  strictEqual(t2.instance.counters.wasmBlockCache.unsupportedCodegenFallbacks, 0);
  strictEqual(t2.instance.counters.wasmBlockCache.inserts, 3);
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
  guestMemoryByteLength?: number;
  fillMemory?: number;
  memoryWrites?: readonly MemoryWrite[];
}>;

type MemoryWrite = Readonly<{
  address: number;
  value: number;
}>;

type MemoryRange = Readonly<{
  address: number;
  length: number;
}>;
