import type { DecodedExit } from "../../exit.js";
import type { WasmHostMemories } from "../../host/memories.js";
import type { RuntimeDecodeReader } from "../../../../x86/isa/runtime/decode-reader.js";
import type { GuestMemory } from "../../../../x86/memory/guest-memory.js";

export type WasmCompiledBlockCodeMap = Readonly<{
  createReader(memory: GuestMemory): RuntimeDecodeReader;
}>;

export type CompiledBlockRun = Readonly<{
  exit: DecodedExit;
}>;

export type CompiledBlockHandle = Readonly<{
  run(): CompiledBlockRun;
}>;

export type CompiledBlockCache = Readonly<{
  getOrCompile(startEip: number, codeMap: WasmCompiledBlockCodeMap, memories: WasmHostMemories): CompiledBlockHandle | undefined;
}>;
