import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";

import { decodeIsaInstruction } from "../../../arch/x86/isa/decoder/decode.js";
import type { IsaDecodedInstruction } from "../../../arch/x86/isa/decoder/types.js";
import { createCpuState, cpuStateFields, type CpuState } from "../../../core/state/cpu-state.js";
import { wasmBlockExportName, wasmImport, stateOffset } from "../../abi.js";
import { decodeExit, ExitReason, type DecodedExit } from "../../exit.js";
import { buildJitSirBlock, encodeJitSirBlock } from "../jit-block.js";

const startAddress = 0x1000;
const preservedEflags = 0xffff_0000;
const zeroFlag = 1 << 6;
const addWraparoundEflags = 0x55;
const zeroResultEflags = 0x44;

test("jit SIR block lowers mov r32, imm32 with static operands", async () => {
  const result = await runJitSirBlock([0xb8, 0x78, 0x56, 0x34, 0x12], createCpuState({ eip: startAddress }));

  strictEqual(result.state.eax, 0x1234_5678);
  strictEqual(result.state.eip, startAddress + 5);
  strictEqual(result.state.instructionCount, 1);
  deepStrictEqual(result.exit, { exitReason: ExitReason.FALLTHROUGH, payload: startAddress + 5 });
});

test("jit SIR block continues through fallthrough instructions until a control exit", async () => {
  const result = await runJitSirBlock(
    [
      0xb8, 0x01, 0x00, 0x00, 0x00, // mov eax, 1
      0x83, 0xc0, 0x01, // add eax, 1
      0x83, 0xc0, 0x01, // add eax, 1
      0xcd, 0x2e // int 0x2e
    ],
    createCpuState({ eip: startAddress })
  );

  strictEqual(result.state.eax, 3);
  strictEqual(result.state.eip, startAddress + 13);
  strictEqual(result.state.instructionCount, 4);
  deepStrictEqual(result.exit, { exitReason: ExitReason.HOST_TRAP, payload: 0x2e });
});

test("jit SIR block lowers memory mov with static effective addresses", async () => {
  const load = await runJitSirBlock(
    [0x8b, 0x43, 0x04],
    createCpuState({ ebx: 0x2000, eip: startAddress }),
    [{ address: 0x2004, bytes: [0x78, 0x56, 0x34, 0x12] }]
  );

  strictEqual(load.state.eax, 0x1234_5678);

  const store = await runJitSirBlock(
    [0x89, 0x43, 0x08],
    createCpuState({ eax: 0xaabb_ccdd, ebx: 0x2000, eip: startAddress })
  );

  strictEqual(store.guestView.getUint32(0x2008, true), 0xaabb_ccdd);
});

test("jit SIR block lowers add and materializes flags", async () => {
  const result = await runJitSirBlock([0x83, 0xc0, 0x01], createCpuState({
    eax: 0xffff_ffff,
    eflags: preservedEflags,
    eip: startAddress
  }));

  strictEqual(result.state.eax, 0);
  strictEqual(result.state.eflags, (preservedEflags | addWraparoundEflags) >>> 0);
  strictEqual(result.state.eip, startAddress + 3);
  strictEqual(result.state.instructionCount, 1);
});

test("jit SIR block lowers cmp without writing operands", async () => {
  const result = await runJitSirBlock([0x39, 0xd8], createCpuState({
    eax: 5,
    ebx: 5,
    eflags: preservedEflags,
    eip: startAddress
  }));

  strictEqual(result.state.eax, 5);
  strictEqual(result.state.ebx, 5);
  strictEqual(result.state.eflags, (preservedEflags | zeroResultEflags) >>> 0);
  strictEqual(result.state.eip, startAddress + 2);
  strictEqual(result.state.instructionCount, 1);
});

test("jit SIR block lowers conditional branches", async () => {
  const taken = await runJitSirBlock([0x75, 0x05], createCpuState({ eip: startAddress }));
  const notTaken = await runJitSirBlock([0x75, 0x05], createCpuState({
    eip: startAddress,
    eflags: zeroFlag
  }));

  deepStrictEqual(taken.exit, { exitReason: ExitReason.BRANCH_TAKEN, payload: startAddress + 7 });
  strictEqual(taken.state.eip, startAddress + 7);
  deepStrictEqual(notTaken.exit, { exitReason: ExitReason.BRANCH_NOT_TAKEN, payload: startAddress + 2 });
  strictEqual(notTaken.state.eip, startAddress + 2);
});

async function runJitSirBlock(
  bytes: readonly number[],
  initialState: CpuState,
  memory: readonly Readonly<{ address: number; bytes: readonly number[] }>[] = []
): Promise<Readonly<{ state: CpuState; exit: DecodedExit; guestView: DataView }>> {
  const instructions = decodeInstructions(bytes, initialState.eip);
  const block = buildJitSirBlock(instructions);
  const module = new WebAssembly.Module(encodeJitSirBlock(block));
  const stateMemory = new WebAssembly.Memory({ initial: 1 });
  const guestMemory = new WebAssembly.Memory({ initial: 1 });
  const stateView = new DataView(stateMemory.buffer);
  const guestView = new DataView(guestMemory.buffer);

  writeState(stateView, initialState);
  writeGuestMemory(guestView, memory);

  const instance = await WebAssembly.instantiate(module, {
    [wasmImport.moduleName]: {
      [wasmImport.stateMemoryName]: stateMemory,
      [wasmImport.guestMemoryName]: guestMemory
    }
  });
  const run = instance.exports[wasmBlockExportName];

  if (typeof run !== "function") {
    throw new Error(`expected exported function '${wasmBlockExportName}'`);
  }

  const encodedExit: unknown = run();

  if (typeof encodedExit !== "bigint") {
    throw new Error(`expected bigint exit result, got ${typeof encodedExit}`);
  }

  return {
    state: readState(stateView),
    exit: decodeExit(encodedExit),
    guestView
  };
}

function decodeInstructions(bytes: readonly number[], address: number): readonly IsaDecodedInstruction[] {
  const raw = Uint8Array.from(bytes);
  const instructions: IsaDecodedInstruction[] = [];
  let offset = 0;
  let eip = address;

  while (offset < raw.length) {
    const result = decodeIsaInstruction(raw, offset, eip);

    if (result.kind !== "ok") {
      throw new Error(`expected decode success, got unsupported byte ${result.unsupportedByte}`);
    }

    instructions.push(result.instruction);
    offset += result.instruction.length;
    eip = result.instruction.nextEip;
  }

  return instructions;
}

function writeState(view: DataView, state: CpuState): void {
  for (const field of cpuStateFields) {
    view.setUint32(stateOffset[field], state[field], true);
  }
}

function writeGuestMemory(
  view: DataView,
  memory: readonly Readonly<{ address: number; bytes: readonly number[] }>[]
): void {
  for (const entry of memory) {
    for (let index = 0; index < entry.bytes.length; index += 1) {
      view.setUint8(entry.address + index, entry.bytes[index] ?? 0);
    }
  }
}

function readState(view: DataView): CpuState {
  const state = createCpuState();

  for (const field of cpuStateFields) {
    state[field] = view.getUint32(stateOffset[field], true);
  }

  return state;
}
