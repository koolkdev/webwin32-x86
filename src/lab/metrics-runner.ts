import type { DecodeReader, DecodeRegion } from "../arch/x86/block-decoder/decode-reader.js";
import type { DecodeFault } from "../arch/x86/decoder/decode-error.js";
import type { RunResult } from "../core/execution/run-result.js";
import { ArrayBufferGuestMemory, type GuestMemory } from "../core/memory/guest-memory.js";
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
    decodeReader: decodeReaderForFixture(fixture),
    initialState: { ...fixture.initialState, eip: fixture.entryEip },
    ...(options.tierMode === undefined ? {} : { tierMode: options.tierMode }),
    ...runtimeMemoryOptions(fixture)
  });
  const result = runtime.run({
    entryEip: fixture.entryEip,
    ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
    ...(fixture.instructionLimit === undefined ? {} : { instructionLimit: fixture.instructionLimit })
  });

  return { runtime, result };
}

function decodeReaderForFixture(fixture: RawX86Fixture): DecodeReader {
  return new RawX86FixtureDecodeReader({
    kind: "guest-bytes",
    baseAddress: fixture.loadAddress,
    bytes: Uint8Array.from(fixture.bytes)
  });
}

function runtimeMemoryOptions(fixture: RawX86Fixture): Readonly<{
  guestMemory?: GuestMemory;
  guestMemoryByteLength?: number;
}> {
  if (fixture.memory.length === 0) {
    return fixture.memorySize === undefined
      ? {}
      : { guestMemoryByteLength: fixture.memorySize };
  }

  const memory = new ArrayBufferGuestMemory(fixture.memorySize ?? requiredMemorySize(fixture));

  for (const entry of fixture.memory) {
    for (let index = 0; index < entry.bytes.length; index += 1) {
      const write = memory.writeU8(entry.address + index, entry.bytes[index] ?? 0);

      if (!write.ok) {
        throw new Error(`fixture memory byte out of bounds at 0x${write.fault.faultAddress.toString(16)}`);
      }
    }
  }

  return { guestMemory: memory };
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

class RawX86FixtureDecodeReader implements DecodeReader {
  constructor(readonly region: DecodeRegion) {}

  regionAt(eip: number): DecodeRegion | undefined {
    const offset = eip - this.region.baseAddress;

    return offset >= 0 && offset < this.region.bytes.length
      ? this.region
      : undefined;
  }

  readU8(eip: number): number | DecodeFault {
    const region = this.regionAt(eip);

    if (region?.kind !== "guest-bytes") {
      return decodeFault(eip);
    }

    const value = region.bytes[eip - region.baseAddress];

    return value ?? decodeFault(eip);
  }

  sliceFrom(eip: number, maxBytes: number): Uint8Array<ArrayBufferLike> | DecodeFault {
    const region = this.regionAt(eip);

    if (region?.kind !== "guest-bytes") {
      return decodeFault(eip);
    }

    const offset = eip - region.baseAddress;

    return region.bytes.slice(offset, offset + maxBytes);
  }
}

function decodeFault(eip: number): DecodeFault {
  return {
    reason: "truncated",
    address: eip,
    offset: 0,
    raw: []
  };
}
