import { strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason } from "../../../core/execution/run-result.js";
import { ExitReason } from "../../../wasm/exit.js";
import { createInstructionBudget } from "../../execution/budget.js";
import { RuntimeCodeMap } from "../../program/code-map.js";
import { createRuntimeWasmMemories } from "../../wasm/memories.js";
import { WasmBlocksEngine } from "../wasm-blocks.js";
import { WasmInterpreterEngine } from "../wasm-interpreter.js";

test("wasm interpreter engine runs with remaining instruction budget", () => {
  let observedFuel = -1;
  const memories = createRuntimeWasmMemories();
  const engine = new WasmInterpreterEngine({
    run(fuel) {
      observedFuel = fuel;
      memories.state.write("eip", 0x1234);
      return { exitReason: ExitReason.HOST_TRAP, payload: 0x2e };
    }
  });

  memories.state.load({ instructionCount: 7 });
  const result = engine.run(
    { codeMap: new RuntimeCodeMap([]), memories },
    createInstructionBudget(5, 10)
  );

  strictEqual(observedFuel, 8);
  strictEqual(result.kind, "done");
  if (result.kind === "done") {
    strictEqual(result.result.stopReason, StopReason.HOST_TRAP);
    strictEqual(result.result.trapVector, 0x2e);
    strictEqual(result.result.finalEip, 0x1234);
  }
});

test("wasm blocks engine reports unavailable when no compiled block exists", () => {
  const engine = new WasmBlocksEngine({
    getOrCompile() {
      return undefined;
    }
  });
  const result = engine.run(
    { codeMap: new RuntimeCodeMap([]), memories: createRuntimeWasmMemories() },
    createInstructionBudget(0, 10)
  );

  strictEqual(result.kind, "unavailable");
  if (result.kind === "unavailable") {
    strictEqual(result.reason, "no-compiled-block");
  }
});
