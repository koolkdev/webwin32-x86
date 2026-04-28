import { metricKey, type MetricSink } from "./collector.js";

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

export type RuntimeMetrics = Readonly<{
  guestInstructions: number;
  finalEip: number;
  stopReason: number;
  decodedBlockCache: Readonly<{
    hits: number;
    misses: number;
  }>;
  profile: Readonly<{
    instructionsExecuted: number;
    blockHits: ReadonlyMap<number, number>;
    edgeHits: ReadonlyMap<number, ReadonlyMap<number, number>>;
  }>;
  wasmBlockCache: RuntimeWasmBlockCacheMetrics;
}>;

export type RuntimeWasmBlockCacheMetrics = Readonly<{
  hits: number;
  misses: number;
  inserts: number;
  unsupportedCodegenFallbacks: number;
}>;

export function recordRuntimeMetrics(collector: MetricSink, metrics: RuntimeMetrics): void {
  collector.setGauge(runtimeMetricKeys.guestInstructions, metrics.guestInstructions);
  collector.setGauge(runtimeMetricKeys.finalEip, metrics.finalEip);
  collector.setGauge(runtimeMetricKeys.stopReason, metrics.stopReason);
  collector.setGauge(runtimeMetricKeys.decodedBlockCacheHits, metrics.decodedBlockCache.hits);
  collector.setGauge(runtimeMetricKeys.decodedBlockCacheMisses, metrics.decodedBlockCache.misses);
  collector.setGauge(
    runtimeMetricKeys.decodedBlockProfileInstructions,
    metrics.profile.instructionsExecuted
  );
  collector.setGauge(runtimeMetricKeys.decodedBlockRuns, sumMapValues(metrics.profile.blockHits));
  collector.setGauge(runtimeMetricKeys.decodedBlockEdges, sumNestedMapValues(metrics.profile.edgeHits));

  if (hasWasmBlockCacheActivity(metrics.wasmBlockCache)) {
    collector.setGauge(runtimeWasmMetricKeys.wasmBlockCacheHits, metrics.wasmBlockCache.hits);
    collector.setGauge(runtimeWasmMetricKeys.wasmBlockCacheMisses, metrics.wasmBlockCache.misses);
    collector.setGauge(runtimeWasmMetricKeys.wasmBlockCacheInserts, metrics.wasmBlockCache.inserts);
    collector.setGauge(
      runtimeWasmMetricKeys.wasmBlockCacheUnsupportedCodegenFallbacks,
      metrics.wasmBlockCache.unsupportedCodegenFallbacks
    );
  }
}

function sumMapValues(values: ReadonlyMap<number, number>): number {
  let total = 0;

  for (const value of values.values()) {
    total += value;
  }

  return total;
}

function sumNestedMapValues(values: ReadonlyMap<number, ReadonlyMap<number, number>>): number {
  let total = 0;

  for (const innerValues of values.values()) {
    total += sumMapValues(innerValues);
  }

  return total;
}

function hasWasmBlockCacheActivity(counters: RuntimeWasmBlockCacheMetrics): boolean {
  return (
    counters.hits !== 0 ||
    counters.misses !== 0 ||
    counters.inserts !== 0 ||
    counters.unsupportedCodegenFallbacks !== 0
  );
}
