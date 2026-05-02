import type { WasmLocalScratchAllocator } from "../../encoder/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../../encoder/function-body.js";
import type { WasmIrExitTarget } from "../../lowering/exit.js";
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
