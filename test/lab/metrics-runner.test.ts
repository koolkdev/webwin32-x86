import { ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason } from "../../src/core/execution/run-result.js";
import { rawX86FixtureFromJson } from "../../src/lab/fixtures/raw-x86-fixture.js";
import {
  MetricsRunner,
  metricsRunnerMetricKeys
} from "../../src/lab/metrics-runner.js";
import { runtimeMetricKeys } from "../../src/metrics/runtime-adapter.js";

const startAddress = 0x1000;

const movAddFixture = rawX86FixtureFromJson({
  id: "mov_add",
  bytes: [
    0xb8, 0x01, 0x00, 0x00, 0x00,
    0x81, 0xc0, 0x02, 0x00, 0x00, 0x00,
    0xcd, 0x2e
  ],
  loadAddress: startAddress,
  expectedState: { eax: 3 }
});

const branchCountdownFixture = rawX86FixtureFromJson({
  id: "branch_countdown",
  bytes: [
    0x83, 0xe8, 0x01,
    0x83, 0xf8, 0x00,
    0x75, 0xf8,
    0xcd, 0x2e
  ],
  loadAddress: startAddress,
  initialState: { eax: 3 },
  expectedState: { eax: 0 }
});

test("metrics_runner_runs_t1_fixture", () => {
  const run = new MetricsRunner().run({ fixture: movAddFixture, runs: 1 });
  const sample = run.samples[0];

  strictEqual(run.fixtureId, "mov_add");
  strictEqual(sample?.result.stopReason, StopReason.HOST_TRAP);
  strictEqual(sample.result.instructionCount, 3);
  strictEqual(run.validation.ok, true);
});

test("metrics_runner_warmup_not_recorded", () => {
  const run = new MetricsRunner().run({ fixture: movAddFixture, warmup: 3, runs: 1 });

  strictEqual(run.samples.length, 1);
  strictEqual(run.samples[0]?.snapshot.gauges[runtimeMetricKeys.guestInstructions], 3);
  strictEqual(run.samples[0]?.snapshot.durationSamples[metricsRunnerMetricKeys.runDurationMs]?.length, 1);
});

test("metrics_runner_records_measured_samples", () => {
  const run = new MetricsRunner().run({ fixture: movAddFixture, runs: 3 });

  strictEqual(run.samples.length, 3);
  for (const sample of run.samples) {
    ok(sample.durationMs >= 0);
    strictEqual(sample.snapshot.durationSamples[metricsRunnerMetricKeys.runDurationMs]?.length, 1);
  }
});

test("metrics_runner_uses_runtime_adapter", () => {
  const run = new MetricsRunner().run({ fixture: branchCountdownFixture, runs: 1 });
  const snapshot = run.samples[0]?.snapshot;

  strictEqual(snapshot?.gauges[runtimeMetricKeys.guestInstructions], 10);
  strictEqual(snapshot?.gauges[runtimeMetricKeys.stopReason], StopReason.HOST_TRAP);
});

test("metrics_runner_validates_expected_state", () => {
  const fixture = rawX86FixtureFromJson({
    id: "bad_expectation",
    bytes: [
      0xb8, 0x01, 0x00, 0x00, 0x00,
      0xcd, 0x2e
    ],
    loadAddress: startAddress,
    expectedState: { eax: 2 }
  });
  const run = new MetricsRunner().run({ fixture, runs: 1 });

  strictEqual(run.validation.ok, false);
  strictEqual(run.validation.mismatches[0]?.field, "eax");
  ok(run.validation.message?.includes("eax"));
});

test("metrics_runner_resets_runtime_per_measured_run", () => {
  const run = new MetricsRunner().run({ fixture: movAddFixture, runs: 2 });

  strictEqual(run.samples.length, 2);
  strictEqual(run.samples[0]?.snapshot.gauges[runtimeMetricKeys.stopReason], StopReason.HOST_TRAP);
  strictEqual(run.samples[1]?.snapshot.gauges[runtimeMetricKeys.stopReason], StopReason.HOST_TRAP);
  strictEqual(run.samples[0]?.snapshot.gauges[runtimeMetricKeys.finalEip], run.samples[1]?.snapshot.gauges[runtimeMetricKeys.finalEip]);
});
