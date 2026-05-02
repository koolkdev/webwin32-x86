import type { DecodedExit } from "../../backends/wasm/exit.js";
import type { InstructionBudget } from "../execution/budget.js";
import { engineDone, type RuntimeEngineResult } from "../execution/engine-result.js";
import type { RuntimeEngine, RuntimeEngineContext } from "../execution/runner.js";
import { runResultFromWasmExit } from "../execution/wasm-exit-result.js";

export type WasmInterpreter = Readonly<{
  run(fuel: number): DecodedExit;
}>;

export class WasmInterpreterEngine implements RuntimeEngine {
  constructor(readonly interpreter: WasmInterpreter) {}

  run(context: RuntimeEngineContext, budget: InstructionBudget): RuntimeEngineResult {
    const remaining = budget.remaining(context.memories.state.instructionCount);
    const exit = this.interpreter.run(remaining);

    return engineDone(runResultFromWasmExit(context.memories.state, exit));
  }
}
