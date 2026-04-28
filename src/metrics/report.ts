import type { MetricSnapshot } from "./collector.js";
import { metricKey } from "./collector.js";
import { runtimeMetricKeys } from "./runtime-adapter.js";

export const metricsReportMetricKeys = {
  runDurationMs: metricKey("metrics.runDurationMs")
} as const;

export type MetricsReport = Readonly<{
  fixture: string;
  tier: string;
  runs: number;
  warmup: number;
  medianMs: number;
  p05Ms: number;
  p95Ms: number;
  guestInstructions: number;
  nsPerGuestInstruction: number;
  decodedBlockCacheHits: number;
  decodedBlockCacheMisses: number;
  finalStateValid: boolean;
}>;

export type MetricsReportSample = Readonly<{
  snapshot: MetricSnapshot;
}>;

export type AggregateMetricsSamplesOptions = Readonly<{
  fixture: string;
  tier: string;
  runs: number;
  warmup: number;
  samples: readonly MetricsReportSample[];
  finalStateValid: boolean;
}>;

export function aggregateMetricsSamples(options: AggregateMetricsSamplesOptions): MetricsReport {
  assertNonNegativeInteger(options.runs, "runs");
  assertNonNegativeInteger(options.warmup, "warmup");

  const durations = collectDurationSamples(options.samples);
  const totalDurationMs = sum(durations);
  const guestInstructions = sumGauge(options.samples, runtimeMetricKeys.guestInstructions);

  return {
    fixture: options.fixture,
    tier: options.tier,
    runs: options.runs,
    warmup: options.warmup,
    medianMs: percentile(durations, 50),
    p05Ms: percentile(durations, 5),
    p95Ms: percentile(durations, 95),
    guestInstructions,
    nsPerGuestInstruction: guestInstructions === 0
      ? 0
      : (totalDurationMs * 1_000_000) / guestInstructions,
    decodedBlockCacheHits: sumGauge(options.samples, runtimeMetricKeys.decodedBlockCacheHits),
    decodedBlockCacheMisses: sumGauge(options.samples, runtimeMetricKeys.decodedBlockCacheMisses),
    finalStateValid: options.finalStateValid
  };
}

export function serializeMetricsReport(report: MetricsReport): string {
  return JSON.stringify(report);
}

function collectDurationSamples(samples: readonly MetricsReportSample[]): number[] {
  const durations: number[] = [];

  for (const sample of samples) {
    durations.push(...(sample.snapshot.durationSamples[metricsReportMetricKeys.runDurationMs] ?? []));
  }

  return durations;
}

function sumGauge(samples: readonly MetricsReportSample[], key: string): number {
  let total = 0;

  for (const sample of samples) {
    total += sample.snapshot.gauges[key] ?? 0;
  }

  return total;
}

function percentile(values: readonly number[], percentileRank: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileRank / 100) * sorted.length) - 1)
  );

  return sorted[index] ?? 0;
}

function sum(values: readonly number[]): number {
  let total = 0;

  for (const value of values) {
    total += value;
  }

  return total;
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
}
