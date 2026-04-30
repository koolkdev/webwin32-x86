import { aggregateMetricsSamples, serializeMetricsReport, type MetricsReport } from "../metrics/report.js";
import { TierMode } from "../runtime/tiering/tier-policy.js";
import type { RawX86Fixture } from "./fixtures/raw-x86-fixture.js";
import { labFixtureById, labFixtureIds } from "./fixtures/registry.js";
import { MetricsRunner } from "./metrics-runner.js";

export type MetricsCommandIo = Readonly<{
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  fixtureById?: (id: string) => RawX86Fixture | undefined;
  fixtureIds?: () => readonly string[];
}>;

type ParsedMetricsCommand = Readonly<{
  fixtureId: string;
  tiers: readonly MetricsTierConfig[];
  runs: number;
  warmup: number;
  json: boolean;
}>;

type MetricsTierConfig = Readonly<{
  name: "t0" | "t1" | "t2";
  mode: TierMode;
}>;

const defaultTierConfigs: readonly MetricsTierConfig[] = [
  { name: "t0", mode: TierMode.T0_ONLY },
  { name: "t1", mode: TierMode.T1_ONLY },
  { name: "t2", mode: TierMode.T2_ONLY }
];

class MetricsCommandError extends Error {}

export function runMetricsCommand(argv: readonly string[], io: MetricsCommandIo = {}): number {
  const writeStdout = io.stdout ?? ((text: string) => process.stdout.write(text));
  const writeStderr = io.stderr ?? ((text: string) => process.stderr.write(text));
  const getFixture = io.fixtureById ?? labFixtureById;
  const getFixtureIds = io.fixtureIds ?? labFixtureIds;

  try {
    const options = parseMetricsCommandArgs(argv);
    const fixture = getFixture(options.fixtureId);

    if (fixture === undefined) {
      throw new MetricsCommandError(
        `unknown fixture '${options.fixtureId}'. available fixtures: ${getFixtureIds().join(", ")}`
      );
    }

    const reports: MetricsReport[] = [];

    for (const tier of options.tiers) {
      const run = new MetricsRunner().run({
        fixture,
        runs: options.runs,
        warmup: options.warmup,
        tierMode: tier.mode
      });

      if (!run.validation.ok) {
        throw new MetricsCommandError(
          `${tier.name} final state validation failed: ${run.validation.message ?? "expected state mismatch"}`
        );
      }

      reports.push(aggregateMetricsSamples({
        fixture: run.fixtureId,
        tier: tier.name,
        runs: options.runs,
        warmup: options.warmup,
        samples: run.samples,
        finalStateValid: run.validation.ok
      }));
    }

    writeStdout(options.json
      ? `${serializeMetricsReports(reports)}\n`
      : formatMetricsReportsText(reports));
    return 0;
  } catch (error) {
    writeStderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function parseMetricsCommandArgs(argv: readonly string[]): ParsedMetricsCommand {
  let fixtureId: string | undefined;
  let tierNames: readonly string[] | undefined;
  let runs = 1;
  let warmup = 0;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--fixture":
        fixtureId = readArgValue(argv, index, arg);
        index += 1;
        break;
      case "--tier":
        tierNames = readArgValue(argv, index, arg)
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
        index += 1;
        break;
      case "--runs":
        runs = parseNonNegativeInteger(readArgValue(argv, index, arg), "runs");
        index += 1;
        break;
      case "--warmup":
        warmup = parseNonNegativeInteger(readArgValue(argv, index, arg), "warmup");
        index += 1;
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new MetricsCommandError(`unknown argument '${arg}'`);
    }
  }

  if (fixtureId === undefined) {
    throw new MetricsCommandError("--fixture is required");
  }

  return {
    fixtureId,
    tiers: parseTierConfigs(tierNames ?? defaultTierConfigs.map((tier) => tier.name)),
    runs,
    warmup,
    json
  };
}

function readArgValue(argv: readonly string[], index: number, arg: string): string {
  const value = argv[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new MetricsCommandError(`${arg} requires a value`);
  }

  return value;
}

function parseNonNegativeInteger(raw: string, label: string): number {
  const value = Number(raw);

  if (!Number.isInteger(value) || value < 0) {
    throw new MetricsCommandError(`${label} must be a non-negative integer`);
  }

  return value;
}

function parseTierConfigs(tierNames: readonly string[]): readonly MetricsTierConfig[] {
  if (tierNames.length === 0) {
    throw new MetricsCommandError("--tier requires at least one tier");
  }

  const configs: MetricsTierConfig[] = [];

  for (const tier of tierNames) {
    const config = defaultTierConfigs.find((candidate) => candidate.name === tier);

    if (config === undefined) {
      throw new MetricsCommandError(`unsupported tier '${tier}'. supported tiers: t0,t1,t2`);
    }

    configs.push(config);
  }

  return configs;
}

function serializeMetricsReports(reports: readonly MetricsReport[]): string {
  return reports.length === 1
    ? serializeMetricsReport(reports[0] as MetricsReport)
    : JSON.stringify(reports);
}

function formatMetricsReportsText(reports: readonly MetricsReport[]): string {
  return reports.length === 1
    ? formatMetricsReportText(reports[0] as MetricsReport)
    : formatMetricsComparisonText(reports);
}

function formatMetricsReportText(report: MetricsReport): string {
  return [
    "Metrics report",
    formatField("Fixture", report.fixture),
    formatField("Tier", report.tier),
    formatField("Runs", report.runs),
    formatField("Warmup", report.warmup),
    formatField("Median", `${formatNumber(report.medianMs)} ms`),
    formatField("P05 / P95", `${formatNumber(report.p05Ms)} / ${formatNumber(report.p95Ms)} ms`),
    formatField("Guest instructions", report.guestInstructions),
    formatField("ns / instruction", formatNumber(report.nsPerGuestInstruction)),
    ...(report.wasmBlockCacheHits === undefined
      ? []
      : [
          formatField(
            "Wasm block cache",
            `${report.wasmBlockCacheHits} hits / ${report.wasmBlockCacheMisses ?? 0} misses`
          ),
          formatField("Wasm inserts", report.wasmBlockCacheInserts ?? 0),
          formatField("Wasm fallbacks", report.wasmBlockCacheUnsupportedCodegenFallbacks ?? 0)
        ]),
    formatField("Final state", report.finalStateValid ? "valid" : "invalid"),
    ""
  ].join("\n");
}

function formatMetricsComparisonText(reports: readonly MetricsReport[]): string {
  const first = reports[0];

  if (first === undefined) {
    return "";
  }

  const rows = [
    [
      "Tier",
      "Median",
      "P05",
      "P95",
      "Guest insn",
      "ns / insn",
      "Wasm cache",
      "Wasm fallback",
      "State"
    ],
    ...reports.map((report) => [
      report.tier,
      `${formatNumber(report.medianMs)} ms`,
      `${formatNumber(report.p05Ms)} ms`,
      `${formatNumber(report.p95Ms)} ms`,
      String(report.guestInstructions),
      formatNumber(report.nsPerGuestInstruction),
      report.wasmBlockCacheHits === undefined
        ? "-"
        : `${report.wasmBlockCacheHits}/${report.wasmBlockCacheMisses ?? 0}/${report.wasmBlockCacheInserts ?? 0}`,
      report.wasmBlockCacheUnsupportedCodegenFallbacks === undefined
        ? "-"
        : String(report.wasmBlockCacheUnsupportedCodegenFallbacks),
      report.finalStateValid ? "valid" : "invalid"
    ])
  ];

  return [
    "Metrics comparison",
    formatField("Fixture", first.fixture),
    formatField("Runs", first.runs),
    formatField("Warmup", first.warmup),
    "",
    formatRows(rows),
    ""
  ].join("\n");
}

function formatRows(rows: readonly (readonly string[])[]): string {
  const widths = rows[0]?.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0))
  ) ?? [];
  const border = `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`;
  const formattedRows = rows.map((row) =>
    `| ${row.map((value, column) => value.padEnd(widths[column] ?? 0, " ")).join(" | ")} |`
  );

  return [
    border,
    formattedRows[0] ?? "",
    border,
    ...formattedRows.slice(1),
    border
  ].join("\n");
}

function formatField(label: string, value: string | number): string {
  return `${label.padEnd(21, " ")}${value}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", {
        maximumFractionDigits: 3,
        minimumFractionDigits: 3
      });
}
