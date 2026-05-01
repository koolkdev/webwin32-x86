import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { createCpuState } from "../../../core/state/cpu-state.js";
import { createRuntimeWasmMemories, wasmPagesForByteLength } from "../memories.js";

test("wasmPagesForByteLength rounds up to WebAssembly pages", () => {
  strictEqual(wasmPagesForByteLength(0), 1);
  strictEqual(wasmPagesForByteLength(1), 1);
  strictEqual(wasmPagesForByteLength(0x1_0000), 1);
  strictEqual(wasmPagesForByteLength(0x1_0001), 2);
});

test("runtime Wasm memories expose canonical state memory", () => {
  const memories = createRuntimeWasmMemories();

  memories.state.load({ eax: 0x1234_5678, eip: 0x401000, instructionCount: 7 });
  memories.state.write("ebx", 0xaabb_ccdd);

  deepStrictEqual(memories.state.snapshot(), createCpuState({
    eax: 0x1234_5678,
    ebx: 0xaabb_ccdd,
    eip: 0x401000,
    instructionCount: 7
  }));
});

test("runtime Wasm guest memory reads writes and reports faults", () => {
  const memories = createRuntimeWasmMemories({ guestMemoryByteLength: 0x20 });

  strictEqual(memories.guest.writeU32(0x10, 0x1234_5678).ok, true);
  deepStrictEqual(memories.guest.readU32(0x10), { ok: true, value: 0x1234_5678 });
  deepStrictEqual(memories.guest.writeU32(memories.guest.byteLength - 2, 0), {
    ok: false,
    fault: {
      faultAddress: memories.guest.byteLength - 2,
      faultSize: 4,
      faultOperation: "write"
    }
  });
});
