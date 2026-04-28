import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { MetricsCollector, type MetricSnapshot } from "../../src/metrics/collector.js";
import {
  aggregateMetricsSamples,
  metricsReportMetricKeys,
  serializeMetricsReport
} from "../../src/metrics/report.js";
import { runtimeMetricKeys } from "../../src/metrics/runtime-adapter.js";

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

test("metrics_report_includes_t1_counters", () => {
  const report = aggregateMetricsSamples({
    fixture: "branch_countdown",
    tier: "t1",
    runs: 2,
    warmup: 0,
    samples: [
      sample({ durationMs: 1, instructions: 10, hits: 2, misses: 1 }),
      sample({ durationMs: 2, instructions: 10, hits: 3, misses: 4 })
    ],
    finalStateValid: true
  });

  strictEqual(report.decodedBlockCacheHits, 5);
  strictEqual(report.decodedBlockCacheMisses, 5);
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
    samples: [sample({ durationMs: 4, instructions: 2, hits: 1, misses: 0 })],
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
    "decodedBlockCacheHits",
    "decodedBlockCacheMisses",
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
  strictEqual("t2CompileFallbacks" in report, false);
  strictEqual("internalTailEdges" in report, false);
});

function sample(options: Readonly<{
  durationMs: number;
  instructions: number;
  hits?: number;
  misses?: number;
}>): Readonly<{ snapshot: MetricSnapshot }> {
  const collector = new MetricsCollector();

  collector.recordDurationSample(metricsReportMetricKeys.runDurationMs, options.durationMs);
  collector.setGauge(runtimeMetricKeys.guestInstructions, options.instructions);
  collector.setGauge(runtimeMetricKeys.decodedBlockCacheHits, options.hits ?? 0);
  collector.setGauge(runtimeMetricKeys.decodedBlockCacheMisses, options.misses ?? 0);

  return { snapshot: collector.snapshot() };
}
