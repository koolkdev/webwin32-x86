import type { RunResult } from "../core/execution/run-result.js";
import type { GuestMemory } from "../core/memory/guest-memory.js";
import { u32, type CpuState } from "../core/state/cpu-state.js";
import { MetricsCollector, type MetricSnapshot } from "../metrics/collector.js";
import { metricsReportMetricKeys } from "../metrics/report.js";
import { RuntimeInstance } from "../runtime/instance/runtime-instance.js";
import type { TierMode } from "../runtime/tiering/tier-policy.js";
import type { RawX86Fixture } from "./fixtures/raw-x86-fixture.js";

export const metricsRunnerMetricKeys = {
  runDurationMs: metricsReportMetricKeys.runDurationMs
} as const;

export type MetricsRunOptions = Readonly<{
  fixture: RawX86Fixture;
  runs: number;
  warmup?: number;
  tierMode?: TierMode;
}>;

export type MeasuredMetricSample = Readonly<{
  durationMs: number;
  result: RunResult;
  snapshot: MetricSnapshot;
}>;

export type MetricsRun = Readonly<{
  fixtureId: string;
  samples: readonly MeasuredMetricSample[];
  validation: FinalStateValidation;
}>;

export type FinalStateValidation = Readonly<{
  ok: boolean;
  message?: string;
  mismatches: readonly FinalStateMismatch[];
}>;

export type FinalStateMismatch = Readonly<{
  field: keyof CpuState;
  expected: number;
  actual: number;
}>;

export class MetricsRunner {
  run(options: MetricsRunOptions): MetricsRun {
    assertRunCount(options.runs, "runs");
    assertRunCount(options.warmup ?? 0, "warmup");

    for (let index = 0; index < (options.warmup ?? 0); index += 1) {
      runFixture(options.fixture, tierRunOptions(options));
    }

    const samples: MeasuredMetricSample[] = [];
    let validation: FinalStateValidation = { ok: true, mismatches: [] };

    for (let index = 0; index < options.runs; index += 1) {
      const collector = new MetricsCollector();
      const startedAt = performance.now();
      const run = runFixture(options.fixture, {
        metrics: collector,
        ...tierRunOptions(options)
      });
      const durationMs = performance.now() - startedAt;

      collector.recordDurationSample(metricsRunnerMetricKeys.runDurationMs, durationMs);

      const sampleValidation = validateExpectedState(options.fixture, run.runtime.state);
      if (!sampleValidation.ok) {
        validation = sampleValidation;
      }

      samples.push({
        durationMs,
        result: run.result,
        snapshot: collector.snapshot()
      });
    }

    return {
      fixtureId: options.fixture.id,
      samples,
      validation
    };
  }
}

function tierRunOptions(options: MetricsRunOptions): Readonly<{ tierMode?: TierMode }> {
  return options.tierMode === undefined
    ? {}
    : { tierMode: options.tierMode };
}

export function validateExpectedState(fixture: RawX86Fixture, state: CpuState): FinalStateValidation {
  const mismatches: FinalStateMismatch[] = [];

  for (const [field, expectedValue] of Object.entries(fixture.expectedState)) {
    const stateField = field as keyof CpuState;
    const expected = u32(expectedValue);
    const actual = u32(state[stateField]);

    if (actual !== expected) {
      mismatches.push({ field: stateField, expected, actual });
    }
  }

  if (mismatches.length === 0) {
    return { ok: true, mismatches: [] };
  }

  return {
    ok: false,
    mismatches,
    message: mismatches
      .map((mismatch) =>
        `${mismatch.field}: expected 0x${mismatch.expected.toString(16)}, got 0x${mismatch.actual.toString(16)}`
      )
      .join("; ")
  };
}

function runFixture(
  fixture: RawX86Fixture,
  options: Readonly<{
    metrics?: MetricsCollector;
    tierMode?: TierMode;
  }> = {}
): Readonly<{ runtime: RuntimeInstance; result: RunResult }> {
  const runtime = new RuntimeInstance({
    program: { baseAddress: fixture.loadAddress, bytes: fixture.bytes },
    initialState: { ...fixture.initialState, eip: fixture.entryEip },
    ...(options.tierMode === undefined ? {} : { tierMode: options.tierMode }),
    ...runtimeMemoryOptions(fixture)
  });

  writeFixtureMemory(runtime.guestMemory, fixture);

  const result = runtime.run({
    entryEip: fixture.entryEip,
    ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
    ...(fixture.instructionLimit === undefined ? {} : { instructionLimit: fixture.instructionLimit })
  });

  return { runtime, result };
}

function runtimeMemoryOptions(fixture: RawX86Fixture): Readonly<{
  guestMemoryByteLength?: number;
}> {
  const requiredByteLength = fixture.memory.length === 0 ? undefined : requiredMemorySize(fixture);
  const byteLength = Math.max(fixture.memorySize ?? 0, requiredByteLength ?? 0);

  return byteLength === 0
    ? {}
    : { guestMemoryByteLength: byteLength };
}

function writeFixtureMemory(memory: GuestMemory, fixture: RawX86Fixture): void {
  for (const entry of fixture.memory) {
    for (let index = 0; index < entry.bytes.length; index += 1) {
      const write = memory.writeU8(entry.address + index, entry.bytes[index] ?? 0);

      if (!write.ok) {
        throw new Error(`fixture memory byte out of bounds at 0x${write.fault.faultAddress.toString(16)}`);
      }
    }
  }
}

function requiredMemorySize(fixture: RawX86Fixture): number {
  let byteLength = 0;

  for (const entry of fixture.memory) {
    byteLength = Math.max(byteLength, entry.address + entry.bytes.length);
  }

  return byteLength;
}

function assertRunCount(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
}
