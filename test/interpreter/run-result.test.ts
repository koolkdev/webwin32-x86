import { notStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { DecodeError } from "../../src/arch/x86/decoder/decode-error.js";
import { decodeOne } from "../../src/arch/x86/decoder/decoder.js";
import {
  runResultFromState,
  runResultMatchesState,
  StopReason,
  type RunResult
} from "../../src/core/execution/run-result.js";
import { createCpuState, type CpuState } from "../../src/core/state/cpu-state.js";
import { runBytes, startAddress } from "../../src/test-support/interpreter.js";

test("int_stop_reason", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runBytes(state, [0xcd, 0x2e]);

  strictEqual(result.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.trapVector, 0x2e);
  strictEqual(result.finalEip, state.eip);
  strictEqual(result.instructionCount, state.instructionCount);
  strictEqual(runResultMatchesState(result, state), true);
});

test("unsupported_stop_reason", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runBytes(state, [0x62]);

  strictEqual(result.stopReason, StopReason.UNSUPPORTED);
  strictEqual(result.finalEip, startAddress);
  strictEqual(result.instructionCount, 0);
  strictEqual(result.unsupportedByte, 0x62);
  strictEqual(result.unsupportedReason, "unsupportedOpcode");
  strictEqual(state.eip, startAddress);
  strictEqual(state.instructionCount, 0);
});

test("decode_fault_stop_reason", () => {
  const state = createCpuState({ eip: startAddress });
  const result = decodeFaultResult(state, [0xb8, 0x01]);

  strictEqual(result.stopReason, StopReason.DECODE_FAULT);
  notStrictEqual(result.stopReason, StopReason.UNSUPPORTED);
  strictEqual(result.finalEip, startAddress);
  strictEqual(result.instructionCount, 0);
  strictEqual(result.faultAddress, startAddress);
  strictEqual(result.faultSize, 2);
  strictEqual(result.faultOperation, "execute");
});

test("instruction_limit_stop_reason", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runBytes(state, [0xeb, 0xfe], { instructionLimit: 2 });

  strictEqual(result.stopReason, StopReason.INSTRUCTION_LIMIT);
  strictEqual(result.finalEip, state.eip);
  strictEqual(result.instructionCount, 2);
  strictEqual(runResultMatchesState(result, state), true);
});

test("host_call_result_shape", () => {
  const state = createCpuState({ eip: startAddress, instructionCount: 7, stopReason: StopReason.HOST_CALL });
  const result = runResultFromState(state, StopReason.HOST_CALL, {
    hostCallId: 42,
    hostCallName: "test.host"
  });

  strictEqual(result.stopReason, StopReason.HOST_CALL);
  strictEqual(result.finalEip, state.eip);
  strictEqual(result.instructionCount, 7);
  strictEqual(result.hostCallId, 42);
  strictEqual(result.hostCallName, "test.host");
  strictEqual(runResultMatchesState(result, state), true);
});

function decodeFaultResult(state: CpuState, bytes: readonly number[]): RunResult {
  try {
    decodeOne(Uint8Array.from(bytes), 0, state.eip);
  } catch (error: unknown) {
    if (!(error instanceof DecodeError)) {
      throw error;
    }

    state.stopReason = StopReason.DECODE_FAULT;

    return runResultFromState(state, StopReason.DECODE_FAULT, {
      faultAddress: error.fault.address,
      faultSize: error.fault.raw.length,
      faultOperation: "execute"
    });
  }

  throw new Error("expected decode fault");
}
