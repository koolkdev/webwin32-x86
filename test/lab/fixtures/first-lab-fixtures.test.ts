import { ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { runMetricsCommand } from "../../../src/lab/metrics-command.js";
import { MetricsRunner } from "../../../src/lab/metrics-runner.js";
import { labFixtureById, labFixtureIds } from "../../../src/lab/fixtures/registry.js";
import { runtimeMetricKeys } from "../../../src/metrics/runtime-adapter.js";
import { TierMode } from "../../../src/runtime/tiering/tier-policy.js";

const firstLabFixtureIds = [
  "register_arithmetic_loop",
  "branch_countdown_loop",
  "memory_load_store_loop",
  "memory_alu_loop"
] as const;

test("metrics_register_arithmetic_loop_runs", () => {
  const run = runFixture("register_arithmetic_loop");

  strictEqual(run.validation.ok, true);
  strictEqual(run.samples[0]?.snapshot.gauges[runtimeMetricKeys.guestInstructions], 4001);
});

test("metrics_branch_countdown_loop_runs", () => {
  const run = runFixture("branch_countdown_loop");
  const snapshot = run.samples[0]?.snapshot;

  strictEqual(run.validation.ok, true);
  strictEqual(snapshot?.gauges[runtimeMetricKeys.guestInstructions], 3001);
});

test("metrics_memory_load_store_loop_runs", () => {
  const run = runFixture("memory_load_store_loop");

  strictEqual(run.validation.ok, true);
  strictEqual(run.samples[0]?.snapshot.gauges[runtimeMetricKeys.guestInstructions], 5001);
});

test("metrics_memory_alu_loop_runs", () => {
  const run = runFixture("memory_alu_loop");

  strictEqual(run.validation.ok, true);
  strictEqual(run.samples[0]?.snapshot.gauges[runtimeMetricKeys.guestInstructions], 4001);
});

test("first_lab_fixture_registry_lists_fixture_files", () => {
  const ids = labFixtureIds();

  for (const id of firstLabFixtureIds) {
    ok(ids.includes(id), id);
  }
});

test("metrics_command_runs_every_first_lab_fixture_under_t1", () => {
  for (const id of firstLabFixtureIds) {
    let stdout = "";
    let stderr = "";
    const code = runMetricsCommand([
      "--fixture", id,
      "--tier", "t1",
      "--runs", "1",
      "--warmup", "0",
      "--json"
    ], {
      stdout: (text) => { stdout += text; },
      stderr: (text) => { stderr += text; }
    });

    strictEqual(code, 0, stderr);
    ok(stdout.includes(`"fixture":"${id}"`), id);
  }
});

function runFixture(id: string): ReturnType<MetricsRunner["run"]> {
  const fixture = labFixtureById(id);

  if (fixture === undefined) {
    throw new Error(`missing fixture ${id}`);
  }

  return new MetricsRunner().run({
    fixture,
    runs: 1,
    warmup: 1,
    tierMode: TierMode.T1_ONLY
  });
}
