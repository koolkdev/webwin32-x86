import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { StopReason } from "../../src/core/execution/run-result.js";
import { cpuStatesEqual } from "../../src/core/state/cpu-state.js";
import { MetricsCollector } from "../../src/metrics/collector.js";
import {
  runtimeMetricKeys,
  runtimeWasmMetricKeys
} from "../../src/metrics/runtime-adapter.js";
import { RuntimeInstance } from "../../src/runtime/instance/runtime-instance.js";
import { TierMode } from "../../src/runtime/tiering/tier-policy.js";
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

test("runtime_metrics_adapter_records_wasm_block_cache_counters", () => {
  const { collector } = runAndRecord(branchLoopFixture, { eax: 3 }, TierMode.T2_ONLY);
  const snapshot = collector.snapshot();

  strictEqual(snapshot.gauges[runtimeWasmMetricKeys.wasmBlockCacheHits], 2);
  strictEqual(snapshot.gauges[runtimeWasmMetricKeys.wasmBlockCacheMisses], 2);
  strictEqual(snapshot.gauges[runtimeWasmMetricKeys.wasmBlockCacheInserts], 2);
  strictEqual(snapshot.gauges[runtimeWasmMetricKeys.wasmBlockCacheUnsupportedCodegenFallbacks], 0);
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

test("runtime_metrics_adapter_does_not_change_execution", () => {
  const runtimeWithMetrics = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes: branchLoopFixture },
    initialState: { eax: 3, eip: startAddress }
  });
  const runtimeWithoutMetrics = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes: branchLoopFixture },
    initialState: { eax: 3, eip: startAddress }
  });
  const collector = new MetricsCollector();

  const resultWithMetrics = runtimeWithMetrics.run({ metrics: collector });
  const resultWithoutMetrics = runtimeWithoutMetrics.run();

  strictEqual(resultWithMetrics.stopReason, resultWithoutMetrics.stopReason);
  ok(cpuStatesEqual(runtimeWithMetrics.state, runtimeWithoutMetrics.state));
  deepStrictEqual(runtimeWithMetrics.counters, runtimeWithoutMetrics.counters);
  strictEqual(collector.snapshot().gauges[runtimeMetricKeys.guestInstructions], 10);
});

test("runtime_does_not_import_lab", () => {
  const runtimeFiles = tsFilesUnder("src/runtime");

  for (const file of runtimeFiles) {
    const source = readFileSync(file, "utf8");

    strictEqual(source.includes("/lab/"), false, file);
    strictEqual(source.includes("../lab/"), false, file);
  }
});

function runAndRecord(
  bytes: readonly number[],
  initialState: Readonly<Record<string, number>> = {},
  tierMode: TierMode = TierMode.T1_ONLY
): Readonly<{ collector: MetricsCollector; runtime: RuntimeInstance; result: ReturnType<RuntimeInstance["run"]> }> {
  const runtime = new RuntimeInstance({
    program: { baseAddress: startAddress, bytes },
    initialState: { ...initialState, eip: startAddress },
    tierMode
  });
  const collector = new MetricsCollector();
  const result = runtime.run({ metrics: collector });

  return { collector, runtime, result };
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
