import type { DecodedInstruction } from "../../arch/x86/instruction/types.js";
import { reg32StateOffset } from "../abi.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import {
  emitCompleteInstruction,
  emitLoadStateU32,
  emitStoreStateConstU32,
  emitStoreStateStackU32
} from "./state.js";

export function emitMov(body: WasmFunctionBodyEncoder, instruction: DecodedInstruction): void {
  const destination = instruction.operands[0];
  const source = instruction.operands[1];

  if (destination?.kind !== "reg32") {
    throw new Error("unsupported mov form for Wasm codegen");
  }

  switch (source?.kind) {
    case "imm32":
      emitStoreStateConstU32(body, reg32StateOffset(destination.reg), source.value);
      break;
    case "reg32":
      body.localGet(0);
      emitLoadStateU32(body, reg32StateOffset(source.reg));
      emitStoreStateStackU32(body, reg32StateOffset(destination.reg));
      break;
    default:
      throw new Error("unsupported mov form for Wasm codegen");
  }

  emitCompleteInstruction(body, instruction);
}
