import { ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { rawX86FixtureFromJson, type RawX86Fixture } from "../../src/lab/fixtures/raw-x86-fixture.js";
import { labFixtureById, labFixtureIds } from "../../src/lab/fixtures/registry.js";
import { runMetricsCommand } from "../../src/lab/metrics-command.js";

test("metrics_command_loads_fixture_file", () => {
  const fixture = labFixtureById("branch_countdown");

  strictEqual(fixture?.id, "branch_countdown");
  strictEqual(labFixtureIds().includes("branch_countdown"), true);
});

test("metrics_command_runs_fixture_t1", () => {
  const output = captureCommand([
    "--fixture", "branch_countdown",
    "--tier", "t1",
    "--runs", "1",
    "--warmup", "0"
  ]);

  strictEqual(output.code, 0);
  strictEqual(output.stderr, "");
  ok(output.stdout.includes("Metrics report"));
  ok(output.stdout.includes("Fixture"));
  ok(output.stdout.includes("branch_countdown"));
  ok(output.stdout.includes("Final state"));
});

test("metrics_command_runs_default_tier_comparison", () => {
  const output = captureCommand([
    "--fixture", "branch_countdown",
    "--runs", "1",
    "--warmup", "0"
  ]);

  strictEqual(output.code, 0);
  strictEqual(output.stderr, "");
  ok(output.stdout.includes("Metrics comparison"));
  ok(output.stdout.includes("| Tier"));
  ok(output.stdout.includes("| t0"));
  ok(output.stdout.includes("| t1"));
  ok(output.stdout.includes("| t2"));
  ok(output.stdout.includes("Wasm cache"));
});

test("metrics_command_json_uses_report_shape", () => {
  const output = captureCommand([
    "--fixture", "branch_countdown",
    "--tier", "t1",
    "--runs", "1",
    "--warmup", "0",
    "--json"
  ]);
  const report = JSON.parse(output.stdout) as Record<string, unknown>;

  strictEqual(output.code, 0);
  strictEqual(report.fixture, "branch_countdown");
  strictEqual(report.tier, "t1");
  strictEqual(report.runs, 1);
  strictEqual(report.finalStateValid, true);
});

test("metrics_command_warmup_option_reaches_runner", () => {
  const output = captureCommand([
    "--fixture", "branch_countdown",
    "--tier", "t1",
    "--runs", "1",
    "--warmup", "3",
    "--json"
  ]);
  const report = JSON.parse(output.stdout) as Record<string, unknown>;

  strictEqual(output.code, 0);
  strictEqual(report.warmup, 3);
});

test("metrics_command_validates_expected_state", () => {
  const fixture = rawX86FixtureFromJson({
    id: "bad_expectation",
    bytes: [
      0xb8, 0x01, 0x00, 0x00, 0x00,
      0xcd, 0x2e
    ],
    loadAddress: 0x1000,
    expectedState: { eax: 2 }
  });
  const output = captureCommand([
    "--fixture", "bad_expectation",
    "--tier", "t1",
    "--runs", "1"
  ], {
    bad_expectation: fixture
  });

  strictEqual(output.code, 1);
  strictEqual(output.stdout, "");
  ok(output.stderr.includes("final state validation failed"));
  ok(output.stderr.includes("eax"));
});

test("metrics_command_rejects_unknown_tier", () => {
  const output = captureCommand([
    "--fixture", "branch_countdown",
    "--tier", "t3",
    "--runs", "1"
  ]);

  strictEqual(output.code, 1);
  strictEqual(output.stdout, "");
  ok(output.stderr.includes("unsupported tier 't3'"));
});

function captureCommand(
  argv: readonly string[],
  fixtures?: Readonly<Record<string, RawX86Fixture>>
): Readonly<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const code = runMetricsCommand(argv, {
    stdout: (text) => { stdout += text; },
    stderr: (text) => { stderr += text; },
    ...(fixtures === undefined
      ? {}
      : {
          fixtureById: (id) => fixtures[id],
          fixtureIds: () => Object.keys(fixtures)
        })
  });

  return { code, stdout, stderr };
}
