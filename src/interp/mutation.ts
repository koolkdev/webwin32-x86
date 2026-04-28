import type { DecodedInstruction } from "../arch/x86/instruction/types.js";
import { runResultFromState, StopReason, type RunResult } from "../core/execution/run-result.js";
import type { CpuState } from "../core/state/cpu-state.js";
import { u32 } from "../core/state/cpu-state.js";
import type { OperandWriteResult } from "./operands.js";

export function runMutation(
  state: CpuState,
  instruction: DecodedInstruction,
  mutation: () => OperandWriteResult
): RunResult {
  const result = mutation();

  switch (result.kind) {
    case "ok":
      state.eip = u32(state.eip + instruction.length);
      state.instructionCount = u32(state.instructionCount + 1);
      return runResultFromState(state, StopReason.NONE);
    case "unsupported":
      state.stopReason = StopReason.UNSUPPORTED;
      return runResultFromState(state, StopReason.UNSUPPORTED);
    case "memoryFault":
      state.stopReason = StopReason.MEMORY_FAULT;
      return runResultFromState(state, StopReason.MEMORY_FAULT, result.fault);
  }
}
