import type { DecodedBlock } from "../../arch/x86/block-decoder/decode-block.js";
import { u32 } from "../../core/state/cpu-state.js";
import { wasmBlockExportName, wasmImport, wasmStatePtr } from "../../wasm/abi.js";
import { WasmBlockCompiler } from "../../wasm/codegen/block.js";
import { decodeExit, type DecodedExit } from "../../wasm/exit.js";
import type { DecodedBlockKey } from "../decoded-block-cache/decoded-block-cache.js";

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
  blockKey: DecodedBlockKey;
  module: WebAssembly.Module;
  instance: WebAssembly.Instance;
  exportedBlockFunction: (statePtr: number) => unknown;
  compileMs: number;
  instantiateMs: number;
  metadata: WasmBlockMetadata;
  run(): WasmBlockRun;
}>;

export type CompileWasmBlockHandleOptions = Readonly<{
  stateMemory: WebAssembly.Memory;
  guestMemory: WebAssembly.Memory;
  blockKey?: DecodedBlockKey;
  compiler?: WasmBlockCompiler;
}>;

const defaultCompiler = new WasmBlockCompiler();

export function compileWasmBlockHandle(
  block: DecodedBlock,
  options: CompileWasmBlockHandleOptions
): WasmBlockHandle {
  const compiler = options.compiler ?? defaultCompiler;
  const bytes = compiler.encodeDecodedBlock(block);
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

function runWasmBlock(exportedBlockFunction: (statePtr: number) => unknown): WasmBlockRun {
  const encodedExit = exportedBlockFunction(wasmStatePtr);

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

function readExportedBlockFunction(instance: WebAssembly.Instance): (statePtr: number) => unknown {
  const value = instance.exports[wasmBlockExportName];

  if (typeof value !== "function") {
    throw new Error(`expected exported function '${wasmBlockExportName}'`);
  }

  return value as (statePtr: number) => unknown;
}
