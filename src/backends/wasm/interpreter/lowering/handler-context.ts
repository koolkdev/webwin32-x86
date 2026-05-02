import type { WasmLocalScratchAllocator } from "#backends/wasm/encoder/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import type { WasmIrExitTarget } from "#backends/wasm/lowering/exit.js";
import type { InterpreterStateCache } from "./state-cache.js";

export type InterpreterHandlerContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  state: InterpreterStateCache;
  exit: WasmIrExitTarget;
  eipLocal: number;
  addressLocal: number;
  opcodeLocal: number;
  instructionDoneLabelDepth: number;
}>;
