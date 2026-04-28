import { deepStrictEqual, match, strictEqual } from "node:assert";
import { test } from "node:test";

import { probeWasmFeatures, type WasmFeatureName, type WasmFeatureReport } from "../src/wasm/probes/features.js";

test("reports required Wasm features as available", async () => {
  const report = await probeWasmFeatures();

  strictEqual(report.baselineJitAvailable, true);
  strictEqual(report.interpreterAvailable, true);
  strictEqual(report.decodedBlockRuntimeAvailable, true);
  deepStrictEqual(report.missingFeatures, []);
  assertFeatureSupported(report, "multi-memory");
  assertFeatureSupported(report, "i64-return-bigint");
  assertFeatureSupported(report, "imported-memory-sharing");
  assertFeatureSupported(report, "branch-hint-metadata");
});

test("failed required probes disable only baseline JIT", async () => {
  const originalCompile = WebAssembly.compile;

  Object.defineProperty(WebAssembly, "compile", {
    configurable: true,
    value: async () => {
      throw new Error("synthetic compile failure");
    }
  });

  try {
    const report = await probeWasmFeatures();

    strictEqual(report.baselineJitAvailable, false);
    strictEqual(report.interpreterAvailable, true);
    strictEqual(report.decodedBlockRuntimeAvailable, true);
    strictEqual(report.missingFeatures.length, 4);

    for (const failure of report.missingFeatures) {
      match(failure.message, /synthetic compile failure/);
    }
  } finally {
    Object.defineProperty(WebAssembly, "compile", {
      configurable: true,
      value: originalCompile
    });
  }
});

function assertFeatureSupported(report: WasmFeatureReport, feature: WasmFeatureName): void {
  const check = report.checks.find((entry) => entry.feature === feature);

  if (check === undefined) {
    throw new Error(`missing feature check '${feature}'`);
  }

  strictEqual(check.supported, true);
}
