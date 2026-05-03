import { deepStrictEqual, ok, strictEqual, throws } from "node:assert";
import { test } from "node:test";

import { decodeIsaBlock } from "#x86/isa/decoder/decode-block.js";
import { GuestMemoryDecodeReader } from "#x86/isa/decoder/guest-memory-reader.js";
import { ArrayBufferGuestMemory } from "#x86/memory/guest-memory.js";
import { createCpuState, type CpuState } from "#x86/state/cpu-state.js";
import {
  compileWasmBlockHandle,
  type WasmBlockHandle,
  wasmBlockExitEncoding
} from "#backends/wasm/jit/block-handle.js";
import {
  assertMemoryImports,
  createGuestMemory,
  readViewBytes,
  startAddress,
} from "#backends/wasm/tests/helpers.js";
import { decodeExit, ExitReason } from "#backends/wasm/exit.js";
import { readWasmCpuState, writeWasmCpuState } from "#backends/wasm/state-layout.js";
import { buildJitIrBlock, encodeJitIrBlock, jitBlockExportName } from "#backends/wasm/jit/block.js";
import { wasmBodyOpcodes } from "#backends/wasm/tests/body-opcodes.js";
import { wasmOpcode, wasmSectionId } from "#backends/wasm/encoder/types.js";

const movAddJumpFixture = [
  0xb8, 0x01, 0x00, 0x00, 0x00,
  0x81, 0xc0, 0x02, 0x00, 0x00, 0x00,
  0xeb, 0x00
] as const;

const movStoreJumpFixture = [
  0x89, 0x05, 0x20, 0x00, 0x00, 0x00,
  0xeb, 0x00
] as const;

const linkedTargetAddress = 0x2000;

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

test("compiled_block_handle_can_compile_multiple_blocks_into_one_module", async () => {
  const { handle, moduleBytes, stateView } = await compileMultiBlockFixture([
    { eip: startAddress, bytes: incEaxJmpRel32(startAddress, linkedTargetAddress) },
    { eip: linkedTargetAddress, bytes: incEaxHostTrap() }
  ]);
  const firstBlockOpcodes = wasmBodyOpcodes(extractFunctionBody(moduleBytes, 0));

  strictEqual(handle.moduleLinkTable, undefined);
  deepStrictEqual(tableImports(handle.module), []);
  ok(firstBlockOpcodes.includes(wasmOpcode.returnCall));
  ok(!firstBlockOpcodes.includes(wasmOpcode.returnCallIndirect));
  ok(handle.instance.exports[jitBlockExportName(startAddress)]);
  ok(handle.instance.exports[jitBlockExportName(linkedTargetAddress)]);
  strictEqual(handle.instance.exports.run, undefined);
  throws(() => handle.run(), /explicit EIP/);

  writeJitState(stateView, createCpuState({ eip: startAddress }));

  const run = handle.run(startAddress);
  const state = readJitState(stateView);

  deepStrictEqual(run.exit, { exitReason: ExitReason.HOST_TRAP, payload: 0x2e });
  strictEqual(state.eax, 2);
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
  const handle = await compileWasmBlockHandle([block], { stateMemory, guestMemory });

  return {
    block,
    handle,
    stateView: new DataView(stateMemory.buffer),
    guestView
  };
}

async function compileMultiBlockFixture(blocks: readonly TestBlock[]): Promise<Readonly<{
  handle: WasmBlockHandle;
  moduleBytes: Uint8Array<ArrayBuffer>;
  stateView: DataView;
  guestView: DataView;
}>> {
  const stateMemory = new WebAssembly.Memory({ initial: 1 });
  const guestMemory = createGuestMemory();
  const guestView = new DataView(guestMemory.buffer);
  const regions = blocks.map((block) => ({
    kind: "guest-memory" as const,
    baseAddress: block.eip,
    byteLength: block.bytes.length
  }));

  for (const block of blocks) {
    writeGuestCodeAt(guestView, block.eip, block.bytes);
  }

  const decodedBlocks = blocks.map((block) =>
    decodeIsaBlock(
      new GuestMemoryDecodeReader(new ArrayBufferGuestMemory(guestMemory.buffer), regions),
      block.eip
    )
  );
  const moduleBytes = encodeJitIrBlock(decodedBlocks.map((block) => buildJitIrBlock(block.instructions)));
  const handle = await compileWasmBlockHandle(decodedBlocks, { stateMemory, guestMemory });

  return {
    handle,
    moduleBytes,
    stateView: new DataView(stateMemory.buffer),
    guestView
  };
}

function writeGuestCode(view: DataView, bytes: readonly number[]): void {
  writeGuestCodeAt(view, startAddress, bytes);
}

function writeGuestCodeAt(view: DataView, eip: number, bytes: readonly number[]): void {
  for (let index = 0; index < bytes.length; index += 1) {
    view.setUint8(eip + index, bytes[index] ?? 0);
  }
}

function writeJitState(view: DataView, state: CpuState): void {
  writeWasmCpuState(view, state);
}

function readJitState(view: DataView): CpuState {
  return readWasmCpuState(view);
}

function tableImports(module: WebAssembly.Module): readonly WebAssembly.ModuleImportDescriptor[] {
  return WebAssembly.Module.imports(module).filter((entry) => entry.kind === "table");
}

function incEaxJmpRel32(blockEip: number, targetEip: number): readonly number[] {
  return [
    0x40,
    ...jmpRel32(blockEip + 1, targetEip)
  ];
}

function incEaxHostTrap(): readonly number[] {
  return [
    0x40,
    0xcd, 0x2e
  ];
}

function jmpRel32(eip: number, targetEip: number): readonly number[] {
  const displacement = targetEip - (eip + 5);

  return [
    0xe9,
    displacement & 0xff,
    (displacement >> 8) & 0xff,
    (displacement >> 16) & 0xff,
    (displacement >> 24) & 0xff
  ];
}

type TestBlock = Readonly<{
  eip: number;
  bytes: readonly number[];
}>;

function extractFunctionBody(moduleBytes: Uint8Array<ArrayBuffer>, functionIndex: number): Uint8Array<ArrayBuffer> {
  let offset = 8;

  while (offset < moduleBytes.length) {
    const sectionId = requiredByte(moduleBytes, offset);
    const sectionSize = readU32Leb128(moduleBytes, offset + 1);
    const sectionStart = sectionSize.nextOffset;
    const sectionEnd = sectionStart + sectionSize.value;

    if (sectionId === wasmSectionId.code) {
      return extractCodeBody(moduleBytes, sectionStart, functionIndex);
    }

    offset = sectionEnd;
  }

  throw new Error("missing Wasm code section");
}

function extractCodeBody(
  moduleBytes: Uint8Array<ArrayBuffer>,
  codeSectionStart: number,
  functionIndex: number
): Uint8Array<ArrayBuffer> {
  const functionCount = readU32Leb128(moduleBytes, codeSectionStart);
  let offset = functionCount.nextOffset;

  if (functionIndex < 0 || functionIndex >= functionCount.value) {
    throw new RangeError(`function index out of range: ${functionIndex}`);
  }

  for (let index = 0; index <= functionIndex; index += 1) {
    const bodySize = readU32Leb128(moduleBytes, offset);
    const bodyStart = bodySize.nextOffset;
    const bodyEnd = bodyStart + bodySize.value;

    if (index === functionIndex) {
      return moduleBytes.slice(bodyStart, bodyEnd);
    }

    offset = bodyEnd;
  }

  throw new Error(`missing function body: ${functionIndex}`);
}

function readU32Leb128(
  bytes: Uint8Array<ArrayBuffer>,
  offset: number
): Readonly<{ value: number; nextOffset: number }> {
  let value = 0;
  let shift = 0;

  while (true) {
    const byte = requiredByte(bytes, offset);

    value |= (byte & 0x7f) << shift;
    offset += 1;

    if ((byte & 0x80) === 0) {
      return { value: value >>> 0, nextOffset: offset };
    }

    shift += 7;
  }
}

function requiredByte(bytes: Uint8Array<ArrayBuffer>, offset: number): number {
  const byte = bytes[offset];

  if (byte === undefined) {
    throw new Error(`unexpected end of Wasm bytes at offset ${offset}`);
  }

  return byte;
}
