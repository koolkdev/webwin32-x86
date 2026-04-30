import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { StopReason } from "../../src/core/execution/run-result.js";
import { createCpuState, type CpuState } from "../../src/core/state/cpu-state.js";
import {
  assertBaselineWasmMatchesInterpreter,
  BaselineWasmComparator,
  type BaselineWasmComparisonResult,
  type BaselineWasmComparisonOptions
} from "../../src/test-support/baseline-wasm-comparison.js";
import { guestReader } from "../../src/test-support/decode-reader.js";
import { createGuestMemory, fillViewBytes } from "../../src/test-support/wasm-codegen.js";
import { startAddress } from "../../src/test-support/x86-code.js";

test("baseline_wasm_mov_add_xor", async () => {
  const result = await runBytes(
    [
      0xb8, 0x01, 0x00, 0x00, 0x00,
      0x81, 0xc0, 0x02, 0x00, 0x00, 0x00,
      0x31, 0xdb,
      0xeb, 0x00
    ],
    createCpuState({ ebx: 0xffff_ffff, eip: startAddress })
  );

  strictEqual(result.wasm.state.eax, 3);
  strictEqual(result.wasm.state.ebx, 0);
  strictEqual(result.wasm.state.stopReason, StopReason.NONE);
  strictEqual(result.report.compiledBlocks, 1);
  strictEqual(result.report.fallbackBlocks, 0);
  strictEqual(result.report.exitCounts.jump, 1);
  ok(result.report.wasmByteLength > 0);
  ok(result.report.compileMs >= 0);
  ok(result.report.instantiateMs >= 0);
});

test("baseline_wasm_cmp_branch_exit", async () => {
  const result = await runBytes(
    [
      0x83, 0xe8, 0x01,
      0x83, 0xf8, 0x00,
      0x75, 0xf8
    ],
    createCpuState({ eax: 3, eip: startAddress })
  );

  strictEqual(result.wasm.state.eax, 0);
  strictEqual(result.wasm.state.instructionCount, 9);
  strictEqual(result.report.compiledBlocks, 1);
  strictEqual(result.report.exitCounts.branchTaken, 2);
  strictEqual(result.report.exitCounts.branchNotTaken, 1);
});

test("baseline_wasm_guest_memory_mov", async () => {
  const guestMemory = createGuestMemory();
  const result = await runBytes(
    [
      0x89, 0x05, 0x20, 0x00, 0x00, 0x00,
      0x8b, 0x1d, 0x20, 0x00, 0x00, 0x00,
      0xeb, 0x00
    ],
    createCpuState({ eax: 0x1234_5678, eip: startAddress }),
    { guestMemory }
  );

  strictEqual(result.wasm.state.ebx, 0x1234_5678);
  deepStrictEqual(Array.from(result.wasm.guestMemory.slice(0x20, 0x24)), [0x78, 0x56, 0x34, 0x12]);
  strictEqual(result.report.exitCounts.jump, 1);
});

test("baseline_wasm_memory_fault_atomicity", async () => {
  const guestMemory = createGuestMemory();
  const guestView = new DataView(guestMemory.buffer);

  fillViewBytes(guestView, 0, 16, 0xaa);

  const beforeGuest = guestViewBytes(guestMemory, 0, 16);
  const result = await runBytes(
    [
      0x8b, 0x05, 0x00, 0x00, 0x01, 0x00,
      0xeb, 0x00
    ],
    createCpuState({
      eax: 0x1111_1111,
      eflags: 0xffff_0000,
      eip: startAddress,
      instructionCount: 7
    }),
    { guestMemory }
  );

  strictEqual(result.wasm.state.eax, 0x1111_1111);
  strictEqual(result.wasm.state.eip, startAddress);
  strictEqual(result.wasm.state.instructionCount, 7);
  strictEqual(result.wasm.state.stopReason, StopReason.MEMORY_FAULT);
  strictEqual(result.report.exitCounts.memoryFault, 1);
  deepStrictEqual(Array.from(result.wasm.guestMemory.slice(0, 16)), beforeGuest);
});

test("baseline_wasm_unsupported_falls_back", async () => {
  const result = await runBytes([0x62], createCpuState({ eax: 0x1234_5678, eip: startAddress }));

  strictEqual(result.wasm.state.eax, 0x1234_5678);
  strictEqual(result.wasm.state.eip, startAddress);
  strictEqual(result.wasm.state.instructionCount, 0);
  strictEqual(result.wasm.state.stopReason, StopReason.UNSUPPORTED);
  strictEqual(result.wasm.result.unsupportedByte, 0x62);
  strictEqual(result.wasm.result.unsupportedReason, "unsupportedOpcode");
  strictEqual(result.report.compiledBlocks, 0);
  strictEqual(result.report.fallbackBlocks, 1);
});

async function runBytes(
  bytes: readonly number[],
  initialState: CpuState,
  options: Omit<BaselineWasmComparisonOptions, "initialState"> = {}
): Promise<BaselineWasmComparisonResult> {
  const guestMemory = options.guestMemory ?? createGuestMemory();

  writeGuestCode(guestMemory, bytes);

  return assertBaselineWasmMatchesInterpreter(new BaselineWasmComparator(guestReader(bytes)), {
    ...options,
    guestMemory,
    initialState
  });
}

function writeGuestCode(memory: WebAssembly.Memory, bytes: readonly number[]): void {
  const view = new DataView(memory.buffer);

  for (let index = 0; index < bytes.length; index += 1) {
    view.setUint8(startAddress + index, bytes[index] ?? 0);
  }
}

function guestViewBytes(memory: WebAssembly.Memory, address: number, length: number): number[] {
  return Array.from(new Uint8Array(memory.buffer).slice(address, address + length));
}
