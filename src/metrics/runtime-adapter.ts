import type { RunResult } from "../core/execution/run-result.js";
import type { RuntimeInstance } from "../runtime/instance/runtime-instance.js";
import { type MetricsCollector, metricKey } from "./collector.js";

export const runtimeMetricKeys = {
  guestInstructions: metricKey("runtime.guestInstructions"),
  finalEip: metricKey("runtime.finalEip"),
  stopReason: metricKey("runtime.stopReason"),
  decodedBlockCacheHits: metricKey("runtime.decodedBlockCacheHits"),
  decodedBlockCacheMisses: metricKey("runtime.decodedBlockCacheMisses"),
  decodedBlockProfileInstructions: metricKey("runtime.decodedBlockProfileInstructions"),
  decodedBlockRuns: metricKey("runtime.decodedBlockRuns"),
  decodedBlockEdges: metricKey("runtime.decodedBlockEdges")
} as const;

export const runtimeWasmMetricKeys = {
  wasmBlockCacheHits: metricKey("runtime.wasmBlockCacheHits"),
  wasmBlockCacheMisses: metricKey("runtime.wasmBlockCacheMisses"),
  wasmBlockCacheInserts: metricKey("runtime.wasmBlockCacheInserts"),
  wasmBlockCacheUnsupportedCodegenFallbacks: metricKey("runtime.wasmBlockCacheUnsupportedCodegenFallbacks")
} as const;

export function recordRuntimeMetrics(
  collector: MetricsCollector,
  runtime: RuntimeInstance,
  result: RunResult
): void {
  const counters = runtime.counters;

  collector.setGauge(runtimeMetricKeys.guestInstructions, result.instructionCount);
  collector.setGauge(runtimeMetricKeys.finalEip, runtime.state.eip);
  collector.setGauge(runtimeMetricKeys.stopReason, result.stopReason);
  collector.setGauge(runtimeMetricKeys.decodedBlockCacheHits, counters.decodedBlockCache.hits);
  collector.setGauge(runtimeMetricKeys.decodedBlockCacheMisses, counters.decodedBlockCache.misses);
  collector.setGauge(
    runtimeMetricKeys.decodedBlockProfileInstructions,
    counters.profile.instructionsExecuted
  );
  collector.setGauge(runtimeMetricKeys.decodedBlockRuns, sumMapValues(counters.profile.blockHits));
  collector.setGauge(runtimeMetricKeys.decodedBlockEdges, sumNestedMapValues(counters.profile.edgeHits));

  if (hasWasmBlockCacheActivity(counters.wasmBlockCache)) {
    collector.setGauge(runtimeWasmMetricKeys.wasmBlockCacheHits, counters.wasmBlockCache.hits);
    collector.setGauge(runtimeWasmMetricKeys.wasmBlockCacheMisses, counters.wasmBlockCache.misses);
    collector.setGauge(runtimeWasmMetricKeys.wasmBlockCacheInserts, counters.wasmBlockCache.inserts);
    collector.setGauge(
      runtimeWasmMetricKeys.wasmBlockCacheUnsupportedCodegenFallbacks,
      counters.wasmBlockCache.unsupportedCodegenFallbacks
    );
  }
}

function sumMapValues(values: ReadonlyMap<unknown, number>): number {
  let total = 0;

  for (const value of values.values()) {
    total += value;
  }

  return total;
}

function sumNestedMapValues(values: ReadonlyMap<unknown, ReadonlyMap<unknown, number>>): number {
  let total = 0;

  for (const innerValues of values.values()) {
    total += sumMapValues(innerValues);
  }

  return total;
}

function hasWasmBlockCacheActivity(counters: RuntimeInstance["counters"]["wasmBlockCache"]): boolean {
  return (
    counters.hits !== 0 ||
    counters.misses !== 0 ||
    counters.inserts !== 0 ||
    counters.unsupportedCodegenFallbacks !== 0
  );
}
