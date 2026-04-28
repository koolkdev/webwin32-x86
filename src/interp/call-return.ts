import { instructionEnd } from "../arch/x86/instruction/address.js";
import type { DecodedInstruction, Operand } from "../arch/x86/instruction/types.js";
import { runResultFromState, StopReason, type RunResult } from "../core/execution/run-result.js";
import type { GuestMemory, MemoryFault } from "../core/memory/guest-memory.js";
import { type CpuState, u32 } from "../core/state/cpu-state.js";
import { jumpTarget } from "./operands.js";
import { pushStackU32, readStackU32 } from "./stack.js";

export function executeCall(
  state: CpuState,
  instruction: DecodedInstruction,
  memory?: GuestMemory
): RunResult {
  const target = jumpTarget(instruction.operands[0]);

  if (target === undefined) {
    return stopUnsupported(state);
  }

  const push = pushStackU32(state, memory, instructionEnd(instruction));

  switch (push.kind) {
    case "ok":
      return completeBranch(state, target);
    case "unsupported":
      return stopUnsupported(state);
    case "memoryFault":
      return stopMemoryFault(state, push.fault);
  }
}

export function executeRet(
  state: CpuState,
  instruction: DecodedInstruction,
  memory?: GuestMemory
): RunResult {
  const cleanup = retCleanupBytes(instruction.operands[0]);

  if (cleanup === undefined) {
    return stopUnsupported(state);
  }

  const pop = readStackU32(state, memory);

  switch (pop.kind) {
    case "value":
      state.esp = u32(pop.nextEsp + cleanup);
      return completeBranch(state, pop.value);
    case "unsupported":
      return stopUnsupported(state);
    case "memoryFault":
      return stopMemoryFault(state, pop.fault);
  }
}

function retCleanupBytes(operand: Operand | undefined): number | undefined {
  if (operand === undefined) {
    return 0;
  }

  return operand.kind === "imm16" ? operand.value : undefined;
}

function completeBranch(state: CpuState, target: number): RunResult {
  state.eip = u32(target);
  state.instructionCount = u32(state.instructionCount + 1);

  return runResultFromState(state, StopReason.NONE);
}

function stopUnsupported(state: CpuState): RunResult {
  state.stopReason = StopReason.UNSUPPORTED;
  return runResultFromState(state, StopReason.UNSUPPORTED);
}

function stopMemoryFault(state: CpuState, fault: MemoryFault): RunResult {
  state.stopReason = StopReason.MEMORY_FAULT;
  return runResultFromState(state, StopReason.MEMORY_FAULT, fault);
}
