import type { DecodedExit } from "../../wasm/exit.js";
import type { RuntimeCodeMap } from "../program/code-map.js";
import type { RuntimeWasmMemories } from "../wasm/memories.js";

export type CompiledBlockRun = Readonly<{
  exit: DecodedExit;
}>;

export type CompiledBlockHandle = Readonly<{
  run(): CompiledBlockRun;
}>;

export type CompiledBlockCache = Readonly<{
  getOrCompile(startEip: number, codeMap: RuntimeCodeMap, memories: RuntimeWasmMemories): CompiledBlockHandle | undefined;
}>;
