import type { WasmHostMemories } from "../../host/memories.js";
import type { CompiledBlockHandle, WasmCompiledBlockCodeMap } from "./block-cache.js";

export type CompiledBlockCompiler = Readonly<{
  compile(startEip: number, codeMap: WasmCompiledBlockCodeMap, memories: WasmHostMemories): CompiledBlockHandle | undefined;
}>;
