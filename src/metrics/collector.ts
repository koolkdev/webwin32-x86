declare const metricKeyBrand: unique symbol;

export type MetricKey = string & { readonly [metricKeyBrand]: true };

export type MetricNumberValues = Readonly<Record<string, number>>;

export type MetricDurationSamples = Readonly<Record<string, readonly number[]>>;

export type MetricSnapshot = Readonly<{
  counters: MetricNumberValues;
  gauges: MetricNumberValues;
  durationSamples: MetricDurationSamples;
}>;

export type MetricSink = Readonly<{
  incrementCounter(key: MetricKey, amount?: number): void;
  setGauge(key: MetricKey, value: number): void;
  recordDurationSample(key: MetricKey, durationMs: number): void;
}>;

export class MetricsCollector {
  readonly #counters = new Map<MetricKey, number>();
  readonly #gauges = new Map<MetricKey, number>();
  readonly #durationSamples = new Map<MetricKey, number[]>();

  incrementCounter(key: MetricKey, amount = 1): void {
    assertFiniteMetricValue(amount, "counter increment");
    this.#counters.set(key, (this.#counters.get(key) ?? 0) + amount);
  }

  setGauge(key: MetricKey, value: number): void {
    assertFiniteMetricValue(value, "gauge value");
    this.#gauges.set(key, value);
  }

  recordDurationSample(key: MetricKey, durationMs: number): void {
    assertFiniteMetricValue(durationMs, "duration sample");
    const samples = this.#durationSamples.get(key);

    if (samples === undefined) {
      this.#durationSamples.set(key, [durationMs]);
      return;
    }

    samples.push(durationMs);
  }

  snapshot(): MetricSnapshot {
    return Object.freeze({
      counters: freezeNumberValues(this.#counters),
      gauges: freezeNumberValues(this.#gauges),
      durationSamples: freezeDurationSamples(this.#durationSamples)
    });
  }

  reset(): void {
    this.clear();
  }

  clear(): void {
    this.#counters.clear();
    this.#gauges.clear();
    this.#durationSamples.clear();
  }
}

export function metricKey(name: string): MetricKey {
  if (name.length === 0) {
    throw new Error("metric key must not be empty");
  }

  return name as MetricKey;
}

export function mergeMetricSnapshots(snapshots: readonly MetricSnapshot[]): MetricSnapshot {
  const collector = new MetricsCollector();

  for (const snapshot of snapshots) {
    for (const [key, value] of Object.entries(snapshot.counters)) {
      collector.incrementCounter(metricKey(key), value);
    }

    for (const [key, value] of Object.entries(snapshot.gauges)) {
      collector.setGauge(metricKey(key), value);
    }

    for (const [key, samples] of Object.entries(snapshot.durationSamples)) {
      for (const sample of samples) {
        collector.recordDurationSample(metricKey(key), sample);
      }
    }
  }

  return collector.snapshot();
}

function freezeNumberValues(values: ReadonlyMap<MetricKey, number>): MetricNumberValues {
  const snapshot: Record<string, number> = {};

  for (const [key, value] of values) {
    snapshot[key] = value;
  }

  return Object.freeze(snapshot);
}

function freezeDurationSamples(values: ReadonlyMap<MetricKey, readonly number[]>): MetricDurationSamples {
  const snapshot: Record<string, readonly number[]> = {};

  for (const [key, samples] of values) {
    snapshot[key] = Object.freeze([...samples]);
  }

  return Object.freeze(snapshot);
}

function assertFiniteMetricValue(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }
}
