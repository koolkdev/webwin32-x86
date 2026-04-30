import { runResultFromState, StopReason, type RunResult } from "../../../core/execution/run-result.js";
import type { RuntimeTierExecutionContext } from "./context.js";
import { runResultFromWasmExit } from "./wasm-exit-result.js";

export function runT1WasmInterpreter(context: RuntimeTierExecutionContext, instructionLimit: number): RunResult {
  const wasmInterpreter = context.wasmInterpreterRuntime;

  if (wasmInterpreter === undefined) {
    throw new Error("T1 Wasm interpreter requires runtime-owned WebAssembly guest memory");
  }

  if (context.decodeReader.regionAt(context.state.eip) === undefined) {
    return stopWithDecodeFault(context, context.state.eip);
  }

  wasmInterpreter.copyStateToWasm(context.state);
  const exit = wasmInterpreter.run(instructionLimit);
  wasmInterpreter.copyStateFromWasm(context.state);

  return runResultFromWasmExit(context.state, exit);
}

function stopWithDecodeFault(context: RuntimeTierExecutionContext, address: number): RunResult {
  context.state.stopReason = StopReason.DECODE_FAULT;
  return runResultFromState(context.state, StopReason.DECODE_FAULT, {
    faultAddress: address,
    faultSize: 0,
    faultOperation: "execute"
  });
}
