import { test } from "node:test";

import { createInstructionBudget } from "../../execution/budget.js";
import {
  assertEngineFixtureResult,
  instantiateFixtureWasmInterpreter,
  prepareEngineFixture
} from "../../tests/fixtures/helpers.js";
import { ENGINE_PROGRAM_FIXTURES } from "../../tests/fixtures/programs.js";
import { WasmInterpreterEngine } from "../wasm-interpreter.js";

for (const fixture of ENGINE_PROGRAM_FIXTURES) {
  test(`wasm interpreter engine runs ${fixture.name}`, () => {
    const { codeMap, memories } = prepareEngineFixture(fixture);
    const engine = new WasmInterpreterEngine(instantiateFixtureWasmInterpreter(memories));
    const result = engine.run({ codeMap, memories }, createInstructionBudget(0, 100));

    assertEngineFixtureResult(fixture, result, memories);
  });
}
