import type { RuntimeCodeMap } from "../program/code-map.js";
import type { RuntimeWasmMemories } from "../wasm/memories.js";
import type { InstructionBudget } from "./budget.js";
import type { RuntimeEngineResult } from "./engine-result.js";
import { RuntimeMode, type RuntimeMode as RuntimeModeValue } from "./mode.js";

export type RuntimeEngineContext = Readonly<{
  codeMap: RuntimeCodeMap;
  memories: RuntimeWasmMemories;
}>;

export type RuntimeEngine = Readonly<{
  run(context: RuntimeEngineContext, budget: InstructionBudget): RuntimeEngineResult;
}>;

export type RuntimeEngines = Readonly<{
  interpreter: RuntimeEngine;
  compiledBlocks: RuntimeEngine;
}>;

export function runRuntimeMode(
  mode: RuntimeModeValue,
  context: RuntimeEngineContext,
  budget: InstructionBudget,
  engines: RuntimeEngines
): RuntimeEngineResult {
  switch (mode) {
    case RuntimeMode.INTERPRETER:
      return engines.interpreter.run(context, budget);
    case RuntimeMode.COMPILED_BLOCKS: {
      const compiled = engines.compiledBlocks.run(context, budget);

      return compiled.kind === "done"
        ? compiled
        : engines.interpreter.run(context, budget);
    }
  }
}
