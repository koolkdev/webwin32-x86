import type { IsaDecodedBlock } from "#x86/isa/decoder/decode-block.js";
import { u32 } from "#x86/state/cpu-state.js";
import { wasmBlockExportName, wasmImport } from "#backends/wasm/abi.js";
import { UnsupportedWasmCodegenError } from "#backends/wasm/errors.js";
import { decodeExit, type DecodedExit } from "#backends/wasm/exit.js";
import {
  buildJitIrBlock,
  encodeJitIrBlock,
  staticJitLinkTargets,
  type JitLinkResolver
} from "./block.js";
import {
  jitModuleLinkFallbackExportName,
  JitModuleLinkTable
} from "./compiled-blocks/module-link-table.js";

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
  moduleLinkTable?: JitModuleLinkTable;
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

  const jitBlock = buildJitIrBlock(block.instructions);
  const moduleLinkTable = createModuleLinkTable(jitBlock);
  const linkResolver = moduleLinkTable === undefined ? undefined : linkResolverForTable(moduleLinkTable);
  const bytes = encodeJitIrBlock(jitBlock, linkResolver === undefined ? {} : { linkResolver });
  const compileStart = performance.now();
  const module = new WebAssembly.Module(bytes);
  const compileMs = performance.now() - compileStart;
  const instantiateStart = performance.now();
  const instance = new WebAssembly.Instance(module, wasmImports(options.stateMemory, options.guestMemory, moduleLinkTable));
  const instantiateMs = performance.now() - instantiateStart;
  installModuleLocalFallbacks(instance, moduleLinkTable);
  const exportedBlockFunction = readExportedBlockFunction(instance);

  return {
    entryEip: u32(block.startEip),
    blockKey: options.blockKey ?? u32(block.startEip),
    module,
    instance,
    exportedBlockFunction,
    ...(moduleLinkTable === undefined ? {} : { moduleLinkTable }),
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

function createModuleLinkTable(jitBlock: ReturnType<typeof buildJitIrBlock>): JitModuleLinkTable | undefined {
  const targetEips = staticJitLinkTargets(jitBlock);

  return targetEips.length === 0 ? undefined : new JitModuleLinkTable({ targetEips });
}

function linkResolverForTable(moduleTable: JitModuleLinkTable): JitLinkResolver {
  return {
    moduleTable,
    slotForStaticTarget: (eip) => moduleTable.slotForTargetEip(eip)
  };
}

function installModuleLocalFallbacks(
  instance: WebAssembly.Instance,
  moduleLinkTable: JitModuleLinkTable | undefined
): void {
  if (moduleLinkTable === undefined) {
    return;
  }

  for (const targetEip of moduleLinkTable.targetEips()) {
    moduleLinkTable.installModuleLocalFallback(
      targetEip,
      readExportedFunction(instance, jitModuleLinkFallbackExportName(targetEip))
    );
  }
}

function wasmImports(
  stateMemory: WebAssembly.Memory,
  guestMemory: WebAssembly.Memory,
  moduleLinkTable: JitModuleLinkTable | undefined
): WebAssembly.Imports {
  return {
    [wasmImport.moduleName]: {
      [wasmImport.stateMemoryName]: stateMemory,
      [wasmImport.guestMemoryName]: guestMemory,
      ...(moduleLinkTable === undefined ? {} : { [wasmImport.linkTableName]: moduleLinkTable.table })
    }
  };
}

function readExportedBlockFunction(instance: WebAssembly.Instance): () => unknown {
  return readExportedFunction(instance, wasmBlockExportName);
}

function readExportedFunction(instance: WebAssembly.Instance, name: string): () => unknown {
  const value = instance.exports[name];

  if (typeof value !== "function") {
    throw new Error(`expected exported function '${name}'`);
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
