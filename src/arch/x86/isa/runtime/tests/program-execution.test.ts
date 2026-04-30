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

test("executes jmp forward to host trap", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runIsaInterpreter(state, bytes([0xeb, 0x02, 0x90, 0x90, 0xcd, 0x2e]), {
    baseAddress: startAddress
  });

  strictEqual(state.eip, startAddress + 6);
  strictEqual(state.instructionCount, 2);
  strictEqual(state.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.trapVector, 0x2e);
});

test("executes rel32 jump backward with instruction limit", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runIsaInterpreter(state, bytes([0x90, 0xe9, 0xfa, 0xff, 0xff, 0xff]), {
    baseAddress: startAddress,
    instructionLimit: 2
  });

  strictEqual(state.eip, startAddress);
  strictEqual(state.instructionCount, 2);
  strictEqual(result.stopReason, StopReason.INSTRUCTION_LIMIT);
  strictEqual(result.finalEip, state.eip);
});

test("executes jz taken", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runIsaInterpreter(state, bytes([
    0x39, 0xc0,
    0x74, 0x05,
    0xbb, 0x01, 0x00, 0x00, 0x00,
    0xb9, 0x02, 0x00, 0x00, 0x00,
    0xcd, 0x2e
  ]), { baseAddress: startAddress });

  strictEqual(state.eip, startAddress + 0x10);
  strictEqual(state.ebx, 0);
  strictEqual(state.ecx, 2);
  strictEqual(state.instructionCount, 4);
  strictEqual(state.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
});

test("executes jz not taken", () => {
  const state = createCpuState({ eax: 2, eip: startAddress });
  const result = runIsaInterpreter(state, bytes([
    0x81, 0xf8, 0x01, 0x00, 0x00, 0x00,
    0x74, 0x05,
    0xbb, 0x01, 0x00, 0x00, 0x00,
    0xcd, 0x2e
  ]), { baseAddress: startAddress });

  strictEqual(state.eip, startAddress + 0x0f);
  strictEqual(state.eax, 2);
  strictEqual(state.ebx, 1);
  strictEqual(state.instructionCount, 4);
  strictEqual(state.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
});

test("executes near jnz taken", () => {
  const state = createCpuState({ eax: 2, eip: startAddress });
  const result = runIsaInterpreter(state, bytes([
    0x81, 0xf8, 0x01, 0x00, 0x00, 0x00,
    0x0f, 0x85, 0x05, 0x00, 0x00, 0x00,
    0xbb, 0x01, 0x00, 0x00, 0x00,
    0xb9, 0x02, 0x00, 0x00, 0x00,
    0xcd, 0x2e
  ]), { baseAddress: startAddress });

  strictEqual(state.eip, startAddress + 0x18);
  strictEqual(state.ebx, 0);
  strictEqual(state.ecx, 2);
  strictEqual(state.instructionCount, 4);
  strictEqual(state.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
});

test("executes signed jl taken", () => {
  const state = createCpuState({ eax: 0xffff_ffff, eip: startAddress });
  const result = runIsaInterpreter(state, bytes([
    0x81, 0xf8, 0x01, 0x00, 0x00, 0x00,
    0x7c, 0x05,
    0xbb, 0x01, 0x00, 0x00, 0x00,
    0xb9, 0x02, 0x00, 0x00, 0x00,
    0xcd, 0x2e
  ]), { baseAddress: startAddress });

  strictEqual(state.eip, startAddress + 0x14);
  strictEqual(state.eax, 0xffff_ffff);
  strictEqual(state.ebx, 0);
  strictEqual(state.ecx, 2);
  strictEqual(state.instructionCount, 4);
  strictEqual(state.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
});

test("executes cmp loop countdown", () => {
  const state = createCpuState({ eax: 3, eip: startAddress });
  const result = runIsaInterpreter(state, bytes([
    0x83, 0xe8, 0x01,
    0x83, 0xf8, 0x00,
    0x75, 0xf8,
    0xcd, 0x2e
  ]), { baseAddress: startAddress });

  strictEqual(state.eip, startAddress + 0x0a);
  strictEqual(state.eax, 0);
  strictEqual(state.instructionCount, 10);
  strictEqual(state.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
});
