import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { runResultMatchesState, StopReason } from "../../../../../core/execution/run-result.js";
import { createCpuState } from "../../../../../core/state/cpu-state.js";
import { runIsaInterpreter } from "../interpreter.js";
import { bytes, startAddress } from "./helpers.js";

test("executes mov immediate then int host trap", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runIsaInterpreter(state, bytes([0xb8, 0x78, 0x56, 0x34, 0x12, 0xcd, 0x2e]), {
    baseAddress: startAddress
  });

  strictEqual(state.eax, 0x1234_5678);
  strictEqual(state.eip, startAddress + 7);
  strictEqual(state.instructionCount, 2);
  strictEqual(state.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.finalEip, state.eip);
  strictEqual(result.trapVector, 0x2e);
  strictEqual(runResultMatchesState(result, state), true);
});

test("executes register mov then int host trap", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runIsaInterpreter(state, bytes([0xb8, 0x01, 0x00, 0x00, 0x00, 0x89, 0xc1, 0xcd, 0x2e]), {
    baseAddress: startAddress
  });

  strictEqual(state.eax, 1);
  strictEqual(state.ecx, 1);
  strictEqual(state.eip, startAddress + 9);
  strictEqual(state.instructionCount, 3);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.finalEip, state.eip);
});

test("executes nop then int host trap", () => {
  const state = createCpuState({ eip: startAddress });
  const beforeRegisters = {
    eax: state.eax,
    ecx: state.ecx,
    edx: state.edx,
    ebx: state.ebx,
    esp: state.esp,
    ebp: state.ebp,
    esi: state.esi,
    edi: state.edi
  };
  const result = runIsaInterpreter(state, bytes([0x90, 0xcd, 0x2e]), { baseAddress: startAddress });

  deepStrictEqual(
    {
      eax: state.eax,
      ecx: state.ecx,
      edx: state.edx,
      ebx: state.ebx,
      esp: state.esp,
      ebp: state.ebp,
      esi: state.esi,
      edi: state.edi
    },
    beforeRegisters
  );
  strictEqual(state.eip, startAddress + 3);
  strictEqual(state.instructionCount, 2);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.finalEip, state.eip);
});

test("unsupported instruction stops without advancing eip or count", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runIsaInterpreter(state, bytes([0x62]), { baseAddress: startAddress });

  strictEqual(state.eip, startAddress);
  strictEqual(state.instructionCount, 0);
  strictEqual(state.stopReason, StopReason.UNSUPPORTED);
  strictEqual(result.stopReason, StopReason.UNSUPPORTED);
  strictEqual(result.finalEip, state.eip);
  strictEqual(result.unsupportedByte, 0x62);
  strictEqual(result.unsupportedReason, "unsupportedOpcode");
});

test("instruction limit stop reason matches state", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runIsaInterpreter(state, bytes([0xeb, 0xfe]), {
    baseAddress: startAddress,
    instructionLimit: 2
  });

  strictEqual(result.stopReason, StopReason.INSTRUCTION_LIMIT);
  strictEqual(result.finalEip, state.eip);
  strictEqual(result.instructionCount, 2);
  strictEqual(runResultMatchesState(result, state), true);
});
