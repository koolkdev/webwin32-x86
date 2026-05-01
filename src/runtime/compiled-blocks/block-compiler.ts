import type { RuntimeCodeMap } from "../program/code-map.js";
import type { RuntimeWasmMemories } from "../wasm/memories.js";
import type { CompiledBlockHandle } from "./block-cache.js";

export type CompiledBlockCompiler = Readonly<{
  compile(startEip: number, codeMap: RuntimeCodeMap, memories: RuntimeWasmMemories): CompiledBlockHandle | undefined;
}>;
