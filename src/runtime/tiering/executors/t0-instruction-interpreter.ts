import { maxInstructionLength } from "../../../arch/x86/decoder/decode-bounds.js";
import { DecodeError, type DecodeFault } from "../../../arch/x86/decoder/decode-error.js";
import { decodeOne } from "../../../arch/x86/decoder/decoder.js";
import type { DecodedInstruction } from "../../../arch/x86/instruction/types.js";
import { runResultFromState, StopReason, type RunResult } from "../../../core/execution/run-result.js";
import { u32, type CpuState } from "../../../core/state/cpu-state.js";
import { executeInstruction } from "../../../interp/interpreter.js";
import type { DecodeReader } from "../../../arch/x86/block-decoder/decode-reader.js";
import type { RuntimeTierExecutionContext } from "./context.js";

type DecodeInstructionResult =
  | Readonly<{ kind: "instruction"; instruction: DecodedInstruction }>
  | Readonly<{ kind: "stop"; result: RunResult }>;

export function runT0InstructionInterpreter(context: RuntimeTierExecutionContext, instructionLimit: number): RunResult {
  let executed = 0;
  let result = runResultFromState(context.state, StopReason.NONE);

  while (executed < instructionLimit) {
    const decoded = decodeInstructionAt(context.decodeReader, context.state);

    if (decoded.kind === "stop") {
      return decoded.result;
    }

    result = executeInstruction(context.state, decoded.instruction, { memory: context.guestMemory });
    executed += 1;

    if (result.stopReason !== StopReason.NONE) {
      return result;
    }

    if (context.decodeReader.regionAt(context.state.eip) === undefined) {
      return result;
    }
  }

  context.state.stopReason = StopReason.INSTRUCTION_LIMIT;
  return runResultFromState(context.state, StopReason.INSTRUCTION_LIMIT);
}

function decodeInstructionAt(decodeReader: DecodeReader, state: CpuState): DecodeInstructionResult {
  const eip = u32(state.eip);
  const bytes = decodeReader.sliceFrom(eip, maxInstructionLength + 1);

  if (!(bytes instanceof Uint8Array)) {
    return stopWithDecodeFault(state, bytes);
  }

  try {
    return { kind: "instruction", instruction: decodeOne(bytes, 0, eip) };
  } catch (error: unknown) {
    if (error instanceof DecodeError) {
      return stopWithDecodeFault(state, error.fault);
    }

    throw error;
  }
}

function stopWithDecodeFault(state: CpuState, fault: DecodeFault): DecodeInstructionResult {
  state.stopReason = StopReason.DECODE_FAULT;
  return {
    kind: "stop",
    result: runResultFromState(state, StopReason.DECODE_FAULT, {
      faultAddress: fault.address,
      faultSize: fault.raw.length,
      faultOperation: "execute"
    })
  };
}
