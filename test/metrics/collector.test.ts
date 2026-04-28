import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { test } from "node:test";

import {
  MetricsCollector,
  mergeMetricSnapshots,
  metricKey
} from "../../src/metrics/collector.js";

const counterKey = metricKey("test.counter");
const gaugeKey = metricKey("test.gauge");
const durationKey = metricKey("test.duration_ms");

test("metrics_collector_records_counter", () => {
  const collector = new MetricsCollector();

  collector.incrementCounter(counterKey);
  collector.incrementCounter(counterKey, 4);

  strictEqual(collector.snapshot().counters[counterKey], 5);
});

test("metrics_collector_records_gauge", () => {
  const collector = new MetricsCollector();

  collector.setGauge(gaugeKey, 10);
  collector.setGauge(gaugeKey, 7);

  strictEqual(collector.snapshot().gauges[gaugeKey], 7);
});

test("metrics_collector_records_duration_samples", () => {
  const collector = new MetricsCollector();

  collector.recordDurationSample(durationKey, 1.25);
  collector.recordDurationSample(durationKey, 2.5);

  deepStrictEqual(collector.snapshot().durationSamples[durationKey], [1.25, 2.5]);
});

test("metrics_collector_snapshot_is_immutable", () => {
  const collector = new MetricsCollector();

  collector.incrementCounter(counterKey);
  collector.setGauge(gaugeKey, 10);
  collector.recordDurationSample(durationKey, 1.25);

  const snapshot = collector.snapshot();

  collector.incrementCounter(counterKey);
  collector.setGauge(gaugeKey, 7);
  collector.recordDurationSample(durationKey, 2.5);

  strictEqual(snapshot.counters[counterKey], 1);
  strictEqual(snapshot.gauges[gaugeKey], 10);
  deepStrictEqual(snapshot.durationSamples[durationKey], [1.25]);
  throws(() => {
    (snapshot.durationSamples[durationKey] as number[]).push(3);
  }, TypeError);
});

test("metrics_collector_reset_clears_values", () => {
  const collector = new MetricsCollector();

  collector.incrementCounter(counterKey);
  collector.setGauge(gaugeKey, 10);
  collector.recordDurationSample(durationKey, 1.25);
  collector.reset();

  deepStrictEqual(collector.snapshot(), {
    counters: {},
    gauges: {},
    durationSamples: {}
  });
});

test("metrics_collector_merges_snapshots", () => {
  const first = new MetricsCollector();
  const second = new MetricsCollector();

  first.incrementCounter(counterKey, 2);
  first.setGauge(gaugeKey, 10);
  first.recordDurationSample(durationKey, 1.25);
  second.incrementCounter(counterKey, 3);
  second.setGauge(gaugeKey, 7);
  second.recordDurationSample(durationKey, 2.5);

  const merged = mergeMetricSnapshots([first.snapshot(), second.snapshot()]);

  strictEqual(merged.counters[counterKey], 5);
  strictEqual(merged.gauges[gaugeKey], 7);
  deepStrictEqual(merged.durationSamples[durationKey], [1.25, 2.5]);
});
