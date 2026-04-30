import type { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";

export type InterpreterHandlerContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  eipLocal: number;
  addressLocal: number;
  opcodeLocal: number;
  instructionDoneLabelDepth: number;
}>;
