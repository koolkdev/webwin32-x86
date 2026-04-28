import type { DecodedInstruction } from "../arch/x86/instruction/types.js";
import { runResultFromState, StopReason, type RunResult } from "../core/execution/run-result.js";
import type { MemoryFault } from "../core/memory/guest-memory.js";
import type { CpuState } from "../core/state/cpu-state.js";
import { u32 } from "../core/state/cpu-state.js";

export type MutationResult =
  | Readonly<{ kind: "ok" }>
  | Readonly<{ kind: "unsupported" }>
  | Readonly<{ kind: "memoryFault"; fault: MemoryFault }>;

export function runMutation(
  state: CpuState,
  instruction: DecodedInstruction,
  mutation: () => MutationResult
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
