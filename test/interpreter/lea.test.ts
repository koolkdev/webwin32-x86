import { strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason } from "../../src/core/execution/run-result.js";
import { ArrayBufferGuestMemory } from "../../src/core/memory/guest-memory.js";
import { createCpuState } from "../../src/core/state/cpu-state.js";
import { runBytes, startAddress } from "../../src/test-support/interpreter.js";

test("lea_base_index_scale_disp", () => {
  const state = createCpuState({ ebx: 0x100, ecx: 3, eip: startAddress });
  const result = runBytes(state, [0x8d, 0x44, 0x8b, 0x10]);

  strictEqual(result.stopReason, StopReason.NONE);
  strictEqual(state.eax, 0x11c);
  strictEqual(state.eip, startAddress + 4);
  strictEqual(state.instructionCount, 1);
});

test("lea_no_base_disp32", () => {
  const state = createCpuState({ ecx: 3, eip: startAddress });
  const result = runBytes(state, [0x8d, 0x04, 0x8d, 0x00, 0x20, 0x40, 0x00]);

  strictEqual(result.stopReason, StopReason.NONE);
  strictEqual(state.eax, 0x0040_200c);
});

test("lea_does_not_read_memory", () => {
  const state = createCpuState({ ebx: 0x100, ecx: 3, eip: startAddress });
  const result = runBytes(state, [0x8d, 0x44, 0x8b, 0x10], {
    memory: new ArrayBufferGuestMemory(8)
  });

  strictEqual(result.stopReason, StopReason.NONE);
  strictEqual(state.stopReason, StopReason.NONE);
  strictEqual(state.eax, 0x11c);
});

test("lea_does_not_modify_flags", () => {
  const flags = 0x8d5;
  const state = createCpuState({ ebx: 0x100, ecx: 3, eflags: flags, eip: startAddress });

  runBytes(state, [0x8d, 0x44, 0x8b, 0x10]);

  strictEqual(state.eflags, flags);
});
