import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { MetricsCollector, type MetricSnapshot } from "../../src/metrics/collector.js";
import {
  aggregateMetricsSamples,
  metricsReportMetricKeys,
  serializeMetricsReport
} from "../../src/metrics/report.js";
import { runtimeMetricKeys, runtimeWasmMetricKeys } from "../../src/metrics/runtime-adapter.js";

test("metrics_report_computes_percentiles", () => {
  const report = aggregateMetricsSamples({
    fixture: "branch_countdown",
    tier: "t1",
    runs: 3,
    warmup: 1,
    samples: [
      sample({ durationMs: 30, instructions: 10 }),
      sample({ durationMs: 10, instructions: 10 }),
      sample({ durationMs: 20, instructions: 10 })
    ],
    finalStateValid: true
  });

  strictEqual(report.medianMs, 20);
  strictEqual(report.p05Ms, 10);
  strictEqual(report.p95Ms, 30);
});

test("metrics_report_sums_guest_instructions", () => {
  const report = aggregateMetricsSamples({
    fixture: "branch_countdown",
    tier: "t1",
    runs: 2,
    warmup: 0,
    samples: [
      sample({ durationMs: 1, instructions: 7 }),
      sample({ durationMs: 2, instructions: 11 })
    ],
    finalStateValid: true
  });

  strictEqual(report.guestInstructions, 18);
  strictEqual(report.nsPerGuestInstruction, (3 * 1_000_000) / 18);
});

test("metrics_report_includes_wasm_block_cache_counters_when_present", () => {
  const report = aggregateMetricsSamples({
    fixture: "branch_countdown",
    tier: "t2",
    runs: 2,
    warmup: 0,
    samples: [
      sample({ durationMs: 1, instructions: 10, wasmHits: 2, wasmMisses: 2, wasmInserts: 1, wasmFallbacks: 1 }),
      sample({ durationMs: 2, instructions: 10, wasmHits: 2, wasmMisses: 2, wasmInserts: 1, wasmFallbacks: 1 })
    ],
    finalStateValid: true
  });

  strictEqual(report.wasmBlockCacheHits, 4);
  strictEqual(report.wasmBlockCacheMisses, 4);
  strictEqual(report.wasmBlockCacheInserts, 2);
  strictEqual(report.wasmBlockCacheUnsupportedCodegenFallbacks, 2);
});

test("metrics_report_includes_final_state_validation", () => {
  const report = aggregateMetricsSamples({
    fixture: "bad_expectation",
    tier: "t1",
    runs: 1,
    warmup: 0,
    samples: [sample({ durationMs: 1, instructions: 1 })],
    finalStateValid: false
  });

  strictEqual(report.finalStateValid, false);
});

test("metrics_report_json_shape_stable", () => {
  const report = aggregateMetricsSamples({
    fixture: "branch_countdown",
    tier: "t1",
    runs: 1,
    warmup: 2,
    samples: [sample({ durationMs: 4, instructions: 2 })],
    finalStateValid: true
  });
  const json = JSON.parse(serializeMetricsReport(report)) as Record<string, unknown>;

  deepStrictEqual(Object.keys(json), [
    "fixture",
    "tier",
    "runs",
    "warmup",
    "medianMs",
    "p05Ms",
    "p95Ms",
    "guestInstructions",
    "nsPerGuestInstruction",
    "finalStateValid"
  ]);
  strictEqual(json.fixture, "branch_countdown");
  strictEqual(json.tier, "t1");
});

test("metrics_report_omits_unimplemented_tier_fields", () => {
  const report = aggregateMetricsSamples({
    fixture: "branch_countdown",
    tier: "t1",
    runs: 1,
    warmup: 0,
    samples: [sample({ durationMs: 1, instructions: 1 })],
    finalStateValid: true
  });

  strictEqual("wasmCompileMs" in report, false);
  strictEqual("wasmBlockCacheHits" in report, false);
  strictEqual("t2CompileFallbacks" in report, false);
  strictEqual("internalTailEdges" in report, false);
});

function sample(options: Readonly<{
  durationMs: number;
  instructions: number;
  wasmHits?: number;
  wasmMisses?: number;
  wasmInserts?: number;
  wasmFallbacks?: number;
}>): Readonly<{ snapshot: MetricSnapshot }> {
  const collector = new MetricsCollector();

  collector.recordDurationSample(metricsReportMetricKeys.runDurationMs, options.durationMs);
  collector.setGauge(runtimeMetricKeys.guestInstructions, options.instructions);

  if (options.wasmHits !== undefined) {
    collector.setGauge(runtimeWasmMetricKeys.wasmBlockCacheHits, options.wasmHits);
    collector.setGauge(runtimeWasmMetricKeys.wasmBlockCacheMisses, options.wasmMisses ?? 0);
    collector.setGauge(runtimeWasmMetricKeys.wasmBlockCacheInserts, options.wasmInserts ?? 0);
    collector.setGauge(
      runtimeWasmMetricKeys.wasmBlockCacheUnsupportedCodegenFallbacks,
      options.wasmFallbacks ?? 0
    );
  }

  return { snapshot: collector.snapshot() };
}
