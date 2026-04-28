import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { StopReason } from "../../src/core/execution/run-result.js";
import { cloneCpuState, cpuStatesEqual } from "../../src/core/state/cpu-state.js";
import { MetricsCollector } from "../../src/metrics/collector.js";
import {
  recordRuntimeMetrics,
  runtimeMetricKeys,
  runtimeWasmMetricKeys
} from "../../src/metrics/runtime-adapter.js";
import { RuntimeInstance, type RuntimeInstanceCounters } from "../../src/runtime/instance/runtime-instance.js";
import { TierMode } from "../../src/runtime/tiering/tier-policy.js";
import { guestReader } from "../../src/test-support/decode-reader.js";
import { startAddress } from "../../src/test-support/x86-code.js";

const movAddFixture = [
  0xb8, 0x01, 0x00, 0x00, 0x00,
  0x81, 0xc0, 0x02, 0x00, 0x00, 0x00,
  0xcd, 0x2e
] as const;

const branchLoopFixture = [
  0x83, 0xe8, 0x01,
  0x83, 0xf8, 0x00,
  0x75, 0xf8,
  0xcd, 0x2e
] as const;

test("runtime_metrics_adapter_records_instruction_count", () => {
  const { collector, runtime, result } = runAndRecord(movAddFixture);
  const snapshot = collector.snapshot();

  strictEqual(result.stopReason, StopReason.HOST_TRAP);
  strictEqual(snapshot.gauges[runtimeMetricKeys.guestInstructions], runtime.state.instructionCount);
  strictEqual(snapshot.gauges[runtimeMetricKeys.finalEip], runtime.state.eip);
});

test("runtime_metrics_adapter_records_cache_counters", () => {
  const { collector } = runAndRecord(branchLoopFixture, { eax: 3 });
  const snapshot = collector.snapshot();

  strictEqual(snapshot.gauges[runtimeMetricKeys.decodedBlockCacheHits], 2);
  strictEqual(snapshot.gauges[runtimeMetricKeys.decodedBlockCacheMisses], 2);
  strictEqual(snapshot.gauges[runtimeMetricKeys.decodedBlockProfileInstructions], 10);
  strictEqual(snapshot.gauges[runtimeMetricKeys.decodedBlockRuns], 4);
  strictEqual(snapshot.gauges[runtimeMetricKeys.decodedBlockEdges], 3);
});

test("runtime_metrics_adapter_records_wasm_block_cache_counters", () => {
  const { collector } = runAndRecord(branchLoopFixture, { eax: 3 }, TierMode.T2_ONLY);
  const snapshot = collector.snapshot();

  strictEqual(snapshot.gauges[runtimeWasmMetricKeys.wasmBlockCacheHits], 2);
  strictEqual(snapshot.gauges[runtimeWasmMetricKeys.wasmBlockCacheMisses], 2);
  strictEqual(snapshot.gauges[runtimeWasmMetricKeys.wasmBlockCacheInserts], 1);
  strictEqual(snapshot.gauges[runtimeWasmMetricKeys.wasmBlockCacheUnsupportedCodegenFallbacks], 1);
});

test("runtime_metrics_adapter_omits_inactive_wasm_block_cache_counters", () => {
  const { collector } = runAndRecord(branchLoopFixture, { eax: 3 });
  const snapshot = collector.snapshot();

  strictEqual(runtimeWasmMetricKeys.wasmBlockCacheHits in snapshot.gauges, false);
  strictEqual(runtimeWasmMetricKeys.wasmBlockCacheMisses in snapshot.gauges, false);
  strictEqual(runtimeWasmMetricKeys.wasmBlockCacheInserts in snapshot.gauges, false);
  strictEqual(runtimeWasmMetricKeys.wasmBlockCacheUnsupportedCodegenFallbacks in snapshot.gauges, false);
});

test("runtime_metrics_adapter_records_stop_reason", () => {
  const { collector, result } = runAndRecord(movAddFixture);

  strictEqual(collector.snapshot().gauges[runtimeMetricKeys.stopReason], result.stopReason);
  strictEqual(collector.snapshot().gauges[runtimeMetricKeys.stopReason], StopReason.HOST_TRAP);
});

test("runtime_metrics_adapter_does_not_mutate_runtime", () => {
  const runtime = new RuntimeInstance({
    decodeReader: guestReader(branchLoopFixture),
    initialState: { eax: 3, eip: startAddress }
  });
  const result = runtime.run();
  const stateBefore = cloneCpuState(runtime.state);
  const countersBefore = snapshotRuntimeCounters(runtime.counters);

  recordRuntimeMetrics(new MetricsCollector(), runtime, result);

  ok(cpuStatesEqual(runtime.state, stateBefore));
  deepStrictEqual(snapshotRuntimeCounters(runtime.counters), countersBefore);
});

test("runtime_does_not_import_metrics", () => {
  const runtimeFiles = tsFilesUnder("src/runtime");

  for (const file of runtimeFiles) {
    const source = readFileSync(file, "utf8");

    strictEqual(source.includes("/metrics/"), false, file);
    strictEqual(source.includes("../metrics/"), false, file);
  }
});

function runAndRecord(
  bytes: readonly number[],
  initialState: Readonly<Record<string, number>> = {},
  tierMode: TierMode = TierMode.T1_ONLY
): Readonly<{ collector: MetricsCollector; runtime: RuntimeInstance; result: ReturnType<RuntimeInstance["run"]> }> {
  const runtime = new RuntimeInstance({
    decodeReader: guestReader(bytes),
    initialState: { ...initialState, eip: startAddress },
    tierMode
  });
  const result = runtime.run();
  const collector = new MetricsCollector();

  recordRuntimeMetrics(collector, runtime, result);

  return { collector, runtime, result };
}

type RuntimeCounterSnapshot = Readonly<{
  decodedBlockCache: Readonly<{ hits: number; misses: number }>;
  profile: Readonly<{
    instructionsExecuted: number;
    blockHits: readonly (readonly [number, number])[];
    edgeHits: readonly (readonly [number, readonly (readonly [number, number])[]])[];
  }>;
  wasmBlockCache: RuntimeInstanceCounters["wasmBlockCache"];
}>;

function snapshotRuntimeCounters(counters: RuntimeInstanceCounters): RuntimeCounterSnapshot {
  return {
    decodedBlockCache: counters.decodedBlockCache,
    profile: {
      instructionsExecuted: counters.profile.instructionsExecuted,
      blockHits: sortedEntries(counters.profile.blockHits),
      edgeHits: sortedNestedEntries(counters.profile.edgeHits)
    },
    wasmBlockCache: counters.wasmBlockCache
  };
}

function sortedEntries(map: ReadonlyMap<number, number>): readonly (readonly [number, number])[] {
  return [...map.entries()].sort(([left], [right]) => left - right);
}

function sortedNestedEntries(
  map: ReadonlyMap<number, ReadonlyMap<number, number>>
): readonly (readonly [number, readonly (readonly [number, number])[]])[] {
  return [...map.entries()]
    .map(([key, values]) => [key, sortedEntries(values)] as const)
    .sort(([left], [right]) => left - right);
}

function tsFilesUnder(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...tsFilesUnder(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }

  return files;
}
