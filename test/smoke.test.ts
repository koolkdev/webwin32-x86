import { strictEqual } from "node:assert";
import { test } from "node:test";

import { smokeValue } from "../src/test-support/smoke.js";

test("runs a TypeScript smoke test through the harness", () => {
  strictEqual(smokeValue, "webwin32");
});
