import { strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason } from "../../src/core/execution/run-result.js";
import { createCpuState } from "../../src/core/state/cpu-state.js";
import { runBytes, startAddress } from "../../src/test-support/interpreter.js";

test("jmp_forward", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runBytes(state, [0xeb, 0x02, 0x90, 0x90, 0xcd, 0x2e]);

  strictEqual(state.eip, 0x1006);
  strictEqual(state.instructionCount, 2);
  strictEqual(state.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.stopReason, StopReason.HOST_TRAP);
  strictEqual(result.trapVector, 0x2e);
});

test("jmp_backward_with_limit", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runBytes(state, [0xeb, 0xfe], { instructionLimit: 3 });

  strictEqual(state.eip, startAddress);
  strictEqual(state.instructionCount, 3);
  strictEqual(state.stopReason, StopReason.INSTRUCTION_LIMIT);
  strictEqual(result.stopReason, StopReason.INSTRUCTION_LIMIT);
  strictEqual(result.finalEip, state.eip);
});

test("jmp_rel32_backward", () => {
  const state = createCpuState({ eip: startAddress });
  const result = runBytes(state, [0x90, 0xe9, 0xfa, 0xff, 0xff, 0xff], { instructionLimit: 2 });

  strictEqual(state.eip, startAddress);
  strictEqual(state.instructionCount, 2);
  strictEqual(result.stopReason, StopReason.INSTRUCTION_LIMIT);
  strictEqual(result.finalEip, state.eip);
});
