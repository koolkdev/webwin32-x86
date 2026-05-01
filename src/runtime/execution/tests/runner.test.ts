import { strictEqual } from "node:assert";
import { test } from "node:test";

import { runResultFromState, StopReason } from "../../../core/execution/run-result.js";
import { createCpuState } from "../../../core/state/cpu-state.js";
import { RuntimeCodeMap } from "../../program/code-map.js";
import { createRuntimeWasmMemories } from "../../wasm/memories.js";
import { createInstructionBudget } from "../budget.js";
import { engineDone, engineUnavailable, type RuntimeEngineResult } from "../engine-result.js";
import { RuntimeMode } from "../mode.js";
import { runRuntimeMode, type RuntimeEngine, type RuntimeEngineContext } from "../runner.js";

test("interpreter mode runs only the interpreter engine", () => {
  const calls: string[] = [];
  const result = runRuntimeMode(RuntimeMode.INTERPRETER, context(), createInstructionBudget(0, 10), {
    interpreter: engine("interpreter", calls, engineDone(runResultFromState(createCpuState({ eip: 0x11 }), StopReason.NONE))),
    compiledBlocks: engine("compiled", calls, engineUnavailable("no-compiled-block"))
  });

  strictEqual(result.kind, "done");
  strictEqual(result.kind === "done" ? result.result.finalEip : 0, 0x11);
  strictEqual(calls.join(","), "interpreter");
});

test("compiled-blocks mode falls back to interpreter when no block is available", () => {
  const calls: string[] = [];
  const result = runRuntimeMode(RuntimeMode.COMPILED_BLOCKS, context(), createInstructionBudget(0, 10), {
    interpreter: engine("interpreter", calls, engineDone(runResultFromState(createCpuState({ eip: 0x22 }), StopReason.NONE))),
    compiledBlocks: engine("compiled", calls, engineUnavailable("no-compiled-block"))
  });

  strictEqual(result.kind, "done");
  strictEqual(result.kind === "done" ? result.result.finalEip : 0, 0x22);
  strictEqual(calls.join(","), "compiled,interpreter");
});

test("compiled-blocks mode returns compiled result when available", () => {
  const calls: string[] = [];
  const result = runRuntimeMode(RuntimeMode.COMPILED_BLOCKS, context(), createInstructionBudget(0, 10), {
    interpreter: engine("interpreter", calls, engineDone(runResultFromState(createCpuState({ eip: 0x11 }), StopReason.NONE))),
    compiledBlocks: engine("compiled", calls, engineDone(runResultFromState(createCpuState({ eip: 0x33 }), StopReason.NONE)))
  });

  strictEqual(result.kind, "done");
  strictEqual(result.kind === "done" ? result.result.finalEip : 0, 0x33);
  strictEqual(calls.join(","), "compiled");
});

function context(): RuntimeEngineContext {
  return {
    codeMap: new RuntimeCodeMap([]),
    memories: createRuntimeWasmMemories()
  };
}

function engine(name: string, calls: string[], result: RuntimeEngineResult): RuntimeEngine {
  return {
    run() {
      calls.push(name);
      return result;
    }
  };
}
