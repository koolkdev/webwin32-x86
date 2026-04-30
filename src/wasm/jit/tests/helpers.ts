import { decodeIsaInstructionFromReader } from "../../../arch/x86/isa/decoder/decode.js";
import { ByteArrayDecodeReader } from "../../../arch/x86/isa/decoder/tests/helpers.js";
import type { IsaDecodedInstruction } from "../../../arch/x86/isa/decoder/types.js";
import { createCpuState, cpuStateFields, type CpuState } from "../../../core/state/cpu-state.js";
import { wasmBlockExportName, wasmImport, stateOffset } from "../../abi.js";
import { decodeExit, type DecodedExit } from "../../exit.js";
import { buildJitSirBlock, encodeJitSirBlock } from "../block.js";

export type JitSirBlockRunResult = Readonly<{
  state: CpuState;
  exit: DecodedExit;
  guestView: DataView;
}>;

export async function runJitSirBlock(
  bytes: readonly number[],
  initialState: CpuState,
  memory: readonly Readonly<{ address: number; bytes: readonly number[] }>[] = []
): Promise<JitSirBlockRunResult> {
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
  const reader = new ByteArrayDecodeReader(raw, address);
  const instructions: IsaDecodedInstruction[] = [];
  let eip = address;

  while (eip - address < raw.length) {
    const result = decodeIsaInstructionFromReader(reader, eip);

    if (result.kind !== "ok") {
      throw new Error(`expected decode success, got unsupported byte ${result.unsupportedByte}`);
    }

    instructions.push(result.instruction);
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
