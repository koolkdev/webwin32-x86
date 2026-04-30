import { maxInstructionLength } from "../../../arch/x86/decoder/decode-bounds.js";
import { decodeIsaInstruction } from "../../../arch/x86/isa/decoder/decode.js";
import type { IsaDecodedInstruction } from "../../../arch/x86/isa/decoder/types.js";
import { executeIsaInstruction } from "../../../arch/x86/isa/runtime/execute.js";
import { runResultFromState, StopReason, type RunResult } from "../../../core/execution/run-result.js";
import { u32, type CpuState } from "../../../core/state/cpu-state.js";
import type { RuntimeTierExecutionContext } from "./context.js";

type DecodeInstructionResult =
  | Readonly<{ kind: "instruction"; instruction: IsaDecodedInstruction }>
  | Readonly<{ kind: "stop"; result: RunResult }>;

export function runT0InstructionInterpreter(context: RuntimeTierExecutionContext, instructionLimit: number): RunResult {
  let executed = 0;
  let result = runResultFromState(context.state, StopReason.NONE);

  while (executed < instructionLimit) {
    if (context.decodeReader.regionAt(context.state.eip) === undefined) {
      return executed === 0 ? decodeFaultResult(context.state, context.state.eip, 0) : result;
    }

    const decoded = decodeInstructionAt(context);

    if (decoded.kind === "stop") {
      return decoded.result;
    }

    result = executeIsaInstruction(context.state, decoded.instruction, { memory: context.guestMemory });
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

function decodeInstructionAt(context: RuntimeTierExecutionContext): DecodeInstructionResult {
  const eip = u32(context.state.eip);
  const bytes = context.decodeReader.sliceFrom(eip, maxInstructionLength + 1);

  if (!(bytes instanceof Uint8Array)) {
    return stopWithDecodeFault(context.state, bytes.address, bytes.raw.length);
  }

  try {
    const decoded = decodeIsaInstruction(bytes, 0, eip);

    if (decoded.kind === "unsupported") {
      return stopWithUnsupported(context.state, decoded.unsupportedByte);
    }

    return { kind: "instruction", instruction: decoded.instruction };
  } catch (error: unknown) {
    if (error instanceof RangeError) {
      return stopWithDecodeFault(context.state, eip, bytes.length);
    }

    throw error;
  }
}

function stopWithDecodeFault(state: CpuState, faultAddress: number, faultSize: number): DecodeInstructionResult {
  state.stopReason = StopReason.DECODE_FAULT;
  return {
    kind: "stop",
    result: decodeFaultResult(state, faultAddress, faultSize)
  };
}

function decodeFaultResult(state: CpuState, faultAddress: number, faultSize: number): RunResult {
  state.stopReason = StopReason.DECODE_FAULT;
  return runResultFromState(state, StopReason.DECODE_FAULT, {
    faultAddress,
    faultSize,
    faultOperation: "execute"
  });
}

function stopWithUnsupported(state: CpuState, unsupportedByte: number | undefined): DecodeInstructionResult {
  state.stopReason = StopReason.UNSUPPORTED;
  return {
    kind: "stop",
    result: runResultFromState(
      state,
      StopReason.UNSUPPORTED,
      unsupportedByte === undefined
        ? { unsupportedReason: "unsupportedOpcode" }
        : { unsupportedByte, unsupportedReason: "unsupportedOpcode" }
    )
  };
}
