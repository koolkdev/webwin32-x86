import type { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import type { InterpreterExitTarget } from "./exit.js";
import type { InterpreterStateCache } from "./state.js";

export type InterpreterHandlerContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  state: InterpreterStateCache;
  exit: InterpreterExitTarget;
  eipLocal: number;
  addressLocal: number;
  opcodeLocal: number;
  instructionDoneLabelDepth: number;
}>;
