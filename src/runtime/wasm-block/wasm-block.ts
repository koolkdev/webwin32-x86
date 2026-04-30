import type { IsaDecodedBlock } from "../../arch/x86/isa/decoder/decode-block.js";
import { u32 } from "../../core/state/cpu-state.js";
import { wasmBlockExportName, wasmImport } from "../../wasm/abi.js";
import { UnsupportedWasmCodegenError } from "../../wasm/errors.js";
import { decodeExit, type DecodedExit } from "../../wasm/exit.js";
import { buildJitSirBlock, encodeJitSirBlock } from "../../wasm/jit/block.js";

export const wasmBlockExitEncoding = {
  resultType: "i64",
  payloadBits: "0..31",
  exitReasonBits: "32..47",
  reservedBits: "48..63"
} as const;

export type WasmBlockExitEncoding = typeof wasmBlockExitEncoding;

export type WasmBlockMetadata = Readonly<{
  instructionCount: number;
  wasmByteLength: number;
  exitEncoding: WasmBlockExitEncoding;
}>;

export type WasmBlockRun = Readonly<{
  encodedExit: bigint;
  exit: DecodedExit;
}>;

export type WasmBlockHandle = Readonly<{
  entryEip: number;
  blockKey: WasmBlockKey;
  module: WebAssembly.Module;
  instance: WebAssembly.Instance;
  exportedBlockFunction: () => unknown;
  compileMs: number;
  instantiateMs: number;
  metadata: WasmBlockMetadata;
  run(): WasmBlockRun;
}>;

export type WasmBlockKey = number;

export type CompileWasmBlockHandleOptions = Readonly<{
  stateMemory: WebAssembly.Memory;
  guestMemory: WebAssembly.Memory;
  blockKey?: WasmBlockKey;
}>;

export function compileWasmBlockHandle(
  block: IsaDecodedBlock,
  options: CompileWasmBlockHandleOptions
): WasmBlockHandle {
  if (block.instructions.length === 0) {
    throw new UnsupportedWasmCodegenError(unsupportedBlockMessage(block));
  }

  const bytes = encodeJitSirBlock(buildJitSirBlock(block.instructions));
  const compileStart = performance.now();
  const module = new WebAssembly.Module(bytes);
  const compileMs = performance.now() - compileStart;
  const instantiateStart = performance.now();
  const instance = new WebAssembly.Instance(module, wasmImports(options.stateMemory, options.guestMemory));
  const instantiateMs = performance.now() - instantiateStart;
  const exportedBlockFunction = readExportedBlockFunction(instance);

  return {
    entryEip: u32(block.startEip),
    blockKey: options.blockKey ?? u32(block.startEip),
    module,
    instance,
    exportedBlockFunction,
    compileMs,
    instantiateMs,
    metadata: {
      instructionCount: block.instructions.length,
      wasmByteLength: bytes.byteLength,
      exitEncoding: wasmBlockExitEncoding
    },
    run: () => runWasmBlock(exportedBlockFunction)
  };
}

function runWasmBlock(exportedBlockFunction: () => unknown): WasmBlockRun {
  const encodedExit = exportedBlockFunction();

  if (typeof encodedExit !== "bigint") {
    throw new Error(`expected bigint exit result, got ${typeof encodedExit}`);
  }

  return {
    encodedExit,
    exit: decodeExit(encodedExit)
  };
}

function wasmImports(stateMemory: WebAssembly.Memory, guestMemory: WebAssembly.Memory): WebAssembly.Imports {
  return {
    [wasmImport.moduleName]: {
      [wasmImport.stateMemoryName]: stateMemory,
      [wasmImport.guestMemoryName]: guestMemory
    }
  };
}

function readExportedBlockFunction(instance: WebAssembly.Instance): () => unknown {
  const value = instance.exports[wasmBlockExportName];

  if (typeof value !== "function") {
    throw new Error(`expected exported function '${wasmBlockExportName}'`);
  }

  return value as () => unknown;
}

function unsupportedBlockMessage(block: IsaDecodedBlock): string {
  switch (block.terminator.kind) {
    case "unsupported":
      return `unsupported x86 opcode at 0x${block.terminator.address.toString(16)}`;
    case "decode-fault":
      return `decode fault at 0x${block.terminator.fault.address.toString(16)}`;
    default:
      return `cannot compile empty block at 0x${block.startEip.toString(16)}`;
  }
}
