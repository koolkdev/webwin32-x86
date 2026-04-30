import {
  runResultFromState,
  StopReason,
  type RunResult,
  type RunResultDetails
} from "../../../core/execution/run-result.js";
import { u32 } from "../../../core/state/cpu-state.js";
import { ExitReason, type DecodedExit } from "../../../wasm/exit.js";
import type { RuntimeTierExecutionContext } from "./context.js";
import { runT1WasmInterpreter } from "./t1-wasm-interpreter.js";

export function runT2WasmBlocks(context: RuntimeTierExecutionContext, instructionLimit: number): RunResult {
  let executed = 0;
  let result = runResultFromState(context.state, StopReason.NONE);

  while (executed < instructionLimit) {
    const currentEip = u32(context.state.eip);
    const remaining = instructionLimit - executed;

    const stateInstructionCount = context.state.instructionCount;
    const wasmRuntime = context.wasmRuntime;

    if (wasmRuntime === undefined) {
      throw new Error("T2 Wasm runtime is not available");
    }

    const wasmBlock = wasmRuntime.blockCache.getOrCompile(currentEip, context.decodeReader);

    if (wasmBlock === undefined) {
      return runT1WasmInterpreter(context, remaining);
    }

    wasmRuntime.copyStateToWasm(context.state);

    const { exit } = wasmBlock.run();

    wasmRuntime.copyStateFromWasm(context.state);
    executed += Math.max(0, context.state.instructionCount - stateInstructionCount);
    result = runResultFromWasmExit(context.state, exit);

    if (result.stopReason !== StopReason.NONE) {
      return result;
    }

    if (executed >= instructionLimit) {
      context.state.stopReason = StopReason.INSTRUCTION_LIMIT;
      return runResultFromState(context.state, StopReason.INSTRUCTION_LIMIT);
    }

    const nextEip = u32(context.state.eip);
    if (context.decodeReader.regionAt(nextEip) === undefined) {
      return result;
    }
  }

  context.state.stopReason = StopReason.INSTRUCTION_LIMIT;
  return runResultFromState(context.state, StopReason.INSTRUCTION_LIMIT);
}

function runResultFromWasmExit(state: RuntimeTierExecutionContext["state"], exit: DecodedExit): RunResult {
  switch (exit.exitReason) {
    case ExitReason.FALLTHROUGH:
    case ExitReason.JUMP:
    case ExitReason.BRANCH_TAKEN:
    case ExitReason.BRANCH_NOT_TAKEN:
      state.stopReason = StopReason.NONE;
      return runResultFromState(state, StopReason.NONE);
    case ExitReason.HOST_TRAP:
      state.stopReason = StopReason.HOST_TRAP;
      return runResultFromState(state, StopReason.HOST_TRAP, { trapVector: exit.payload });
    case ExitReason.UNSUPPORTED:
      state.stopReason = StopReason.UNSUPPORTED;
      return runResultFromState(state, StopReason.UNSUPPORTED, unsupportedDetails(exit.payload));
    case ExitReason.DECODE_FAULT:
      state.stopReason = StopReason.DECODE_FAULT;
      return runResultFromState(state, StopReason.DECODE_FAULT, {
        faultAddress: exit.payload,
        faultOperation: "execute"
      });
    case ExitReason.MEMORY_READ_FAULT:
      return stopWithMemoryFault(state, exit, "read");
    case ExitReason.MEMORY_WRITE_FAULT:
      return stopWithMemoryFault(state, exit, "write");
    case ExitReason.INSTRUCTION_LIMIT:
      state.stopReason = StopReason.INSTRUCTION_LIMIT;
      return runResultFromState(state, StopReason.INSTRUCTION_LIMIT);
  }
}

function unsupportedDetails(byte: number): RunResultDetails {
  return {
    unsupportedByte: byte & 0xff,
    unsupportedReason: "unsupportedOpcode"
  };
}

function stopWithMemoryFault(
  state: RuntimeTierExecutionContext["state"],
  exit: DecodedExit,
  faultOperation: "read" | "write"
): RunResult {
  state.stopReason = StopReason.MEMORY_FAULT;
  return runResultFromState(state, StopReason.MEMORY_FAULT, {
    faultAddress: exit.payload,
    faultSize: 4,
    faultOperation
  });
}
