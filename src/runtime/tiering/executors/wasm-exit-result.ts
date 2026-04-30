import {
  runResultFromState,
  StopReason,
  type RunResult,
  type RunResultDetails
} from "../../../core/execution/run-result.js";
import { ExitReason, type DecodedExit } from "../../../wasm/exit.js";
import type { RuntimeTierExecutionContext } from "./context.js";

export function runResultFromWasmExit(state: RuntimeTierExecutionContext["state"], exit: DecodedExit): RunResult {
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
