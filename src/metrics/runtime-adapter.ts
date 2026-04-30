import { metricKey, type MetricSink } from "./collector.js";

export const runtimeMetricKeys = {
  guestInstructions: metricKey("runtime.guestInstructions"),
  finalEip: metricKey("runtime.finalEip"),
  stopReason: metricKey("runtime.stopReason")
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

function hasWasmBlockCacheActivity(counters: RuntimeWasmBlockCacheMetrics): boolean {
  return (
    counters.hits !== 0 ||
    counters.misses !== 0 ||
    counters.inserts !== 0 ||
    counters.unsupportedCodegenFallbacks !== 0
  );
}
