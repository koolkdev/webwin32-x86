import { runResultFromState, StopReason, type RunResult } from "../../../../core/execution/run-result.js";
import type { GuestMemory } from "../../../../core/memory/guest-memory.js";
import type { CpuState } from "../../../../core/state/cpu-state.js";
import { decodeIsaInstruction } from "../decoder/decode.js";
import { executeIsaInstruction } from "./execute.js";

const defaultInstructionLimit = 10_000;

export type IsaInterpreterOptions = Readonly<{
  baseAddress?: number;
  instructionLimit?: number;
  memory?: GuestMemory;
}>;

export function runIsaInterpreter(
  state: CpuState,
  bytes: Uint8Array<ArrayBufferLike>,
  options: IsaInterpreterOptions = {}
): RunResult {
  const baseAddress = options.baseAddress ?? state.eip;
  const instructionLimit = options.instructionLimit ?? defaultInstructionLimit;

  for (let executed = 0; executed < instructionLimit; executed += 1) {
    const offset = state.eip - baseAddress;

    if (!Number.isInteger(offset) || offset < 0 || offset >= bytes.length) {
      return runResultFromState(state, StopReason.NONE);
    }

    const decoded = decodeIsaInstruction(bytes, offset, state.eip);

    if (decoded.kind === "unsupported") {
      state.stopReason = StopReason.UNSUPPORTED;
      return runResultFromState(
        state,
        StopReason.UNSUPPORTED,
        decoded.unsupportedByte === undefined
          ? { unsupportedReason: "unsupportedOpcode" }
          : { unsupportedByte: decoded.unsupportedByte, unsupportedReason: "unsupportedOpcode" }
      );
    }

    const result =
      options.memory === undefined
        ? executeIsaInstruction(state, decoded.instruction)
        : executeIsaInstruction(state, decoded.instruction, { memory: options.memory });

    if (result.stopReason !== StopReason.NONE) {
      return result;
    }
  }

  state.stopReason = StopReason.INSTRUCTION_LIMIT;
  return runResultFromState(state, StopReason.INSTRUCTION_LIMIT);
}
