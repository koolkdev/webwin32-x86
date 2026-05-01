import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeIsaBlock } from "../../../arch/x86/isa/decoder/decode-block.js";
import { GuestMemoryDecodeReader } from "../../../arch/x86/isa/runtime/decode-reader.js";
import { ArrayBufferGuestMemory } from "../../../core/memory/guest-memory.js";
import { createCpuState, cpuStateFields, type CpuState } from "../../../core/state/cpu-state.js";
import {
  compileWasmBlockHandle,
  type WasmBlockHandle,
  wasmBlockExitEncoding
} from "../wasm-block.js";
import {
  assertMemoryImports,
  createGuestMemory,
  readViewBytes,
  startAddress,
} from "../../../wasm/tests/helpers.js";
import { stateOffset } from "../../../wasm/abi.js";
import { decodeExit, ExitReason } from "../../../wasm/exit.js";

const movAddJumpFixture = [
  0xb8, 0x01, 0x00, 0x00, 0x00,
  0x81, 0xc0, 0x02, 0x00, 0x00, 0x00,
  0xeb, 0x00
] as const;

const movStoreJumpFixture = [
  0x89, 0x05, 0x20, 0x00, 0x00, 0x00,
  0xeb, 0x00
] as const;

test("compiled_block_handle_can_invoke_simple_block", async () => {
  const { handle, stateView } = await compileFixture(movAddJumpFixture);

  writeJitState(stateView, createCpuState({ eip: startAddress }));

  const run = handle.run();
  const state = readJitState(stateView);

  strictEqual(run.exit.exitReason, ExitReason.JUMP);
  strictEqual(state.eax, 3);
  strictEqual(state.eip, run.exit.payload);
  strictEqual(state.instructionCount, 3);
  strictEqual(handle.entryEip, startAddress);
  strictEqual(handle.blockKey, startAddress);
});

test("compiled_block_exit_decodes_correctly", async () => {
  const { handle, stateView } = await compileFixture(movAddJumpFixture);

  writeJitState(stateView, createCpuState({ eip: startAddress }));

  const run = handle.run();

  deepStrictEqual(decodeExit(run.encodedExit), run.exit);
  strictEqual(run.exit.exitReason, ExitReason.JUMP);
  strictEqual(run.exit.payload, startAddress + movAddJumpFixture.length);
});

test("compiled_block_reports_compile_and_instantiate_time", async () => {
  const { handle, block } = await compileFixture(movAddJumpFixture);

  ok(handle.compileMs >= 0);
  ok(handle.instantiateMs >= 0);
  ok(handle.module instanceof WebAssembly.Module);
  ok(handle.instance instanceof WebAssembly.Instance);
  strictEqual(typeof handle.exportedBlockFunction, "function");
  strictEqual(handle.metadata.instructionCount, block.instructions.length);
  ok(handle.metadata.wasmByteLength > 0);
  deepStrictEqual(handle.metadata.exitEncoding, wasmBlockExitEncoding);
});

test("compiled_block_keeps_state_memory_abi", async () => {
  const { handle, stateView } = await compileFixture(movAddJumpFixture);

  writeJitState(stateView, createCpuState({ ebx: 0xaabb_ccdd, eip: startAddress }));
  handle.run();

  const state = readJitState(stateView);

  strictEqual(state.eax, 3);
  strictEqual(state.ebx, 0xaabb_ccdd);
  strictEqual(state.eip, startAddress + movAddJumpFixture.length);
  strictEqual(state.instructionCount, 3);
});

test("compiled_block_guest_memory_abi_unchanged", async () => {
  const { handle, stateView, guestView } = await compileFixture(movStoreJumpFixture);

  assertMemoryImports(handle.module);
  writeJitState(stateView, createCpuState({ eax: 0x1234_5678, eip: startAddress }));
  handle.run();

  deepStrictEqual(readViewBytes(guestView, 0x20, 4), [0x78, 0x56, 0x34, 0x12]);
});

async function compileFixture(bytes: readonly number[]): Promise<Readonly<{
  block: ReturnType<typeof decodeIsaBlock>;
  handle: WasmBlockHandle;
  stateView: DataView;
  guestView: DataView;
}>> {
  const stateMemory = new WebAssembly.Memory({ initial: 1 });
  const guestMemory = createGuestMemory();
  const guestView = new DataView(guestMemory.buffer);

  writeGuestCode(guestView, bytes);

  const block = decodeIsaBlock(
    new GuestMemoryDecodeReader(new ArrayBufferGuestMemory(guestMemory.buffer), [
      { kind: "guest-memory", baseAddress: startAddress, byteLength: bytes.length }
    ]),
    startAddress
  );
  const handle = await compileWasmBlockHandle(block, { stateMemory, guestMemory });

  return {
    block,
    handle,
    stateView: new DataView(stateMemory.buffer),
    guestView
  };
}

function writeGuestCode(view: DataView, bytes: readonly number[]): void {
  for (let index = 0; index < bytes.length; index += 1) {
    view.setUint8(startAddress + index, bytes[index] ?? 0);
  }
}

function writeJitState(view: DataView, state: CpuState): void {
  for (const field of cpuStateFields) {
    view.setUint32(stateOffset[field], state[field], true);
  }
}

function readJitState(view: DataView): CpuState {
  const state = createCpuState();

  for (const field of cpuStateFields) {
    state[field] = view.getUint32(stateOffset[field], true);
  }

  return state;
}
