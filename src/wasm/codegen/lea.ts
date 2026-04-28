import type { DecodedInstruction } from "../../arch/x86/instruction/types.js";
import { reg32StateOffset } from "../abi.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { unsupportedWasmCodegen } from "./errors.js";
import { emitEffectiveAddress } from "./effective-address.js";
import { emitCompleteInstruction, emitStoreStateStackU32 } from "./state.js";

export function emitLea(body: WasmFunctionBodyEncoder, instruction: DecodedInstruction): void {
  const destination = instruction.operands[0];
  const source = instruction.operands[1];

  if (destination?.kind !== "reg32" || source?.kind !== "mem32") {
    unsupportedWasmCodegen("unsupported LEA form for Wasm codegen");
  }

  body.localGet(0);
  emitEffectiveAddress(body, source);
  emitStoreStateStackU32(body, reg32StateOffset(destination.reg));
  emitCompleteInstruction(body, instruction);
}
