import type { DecodedInstruction } from "../../arch/x86/instruction/types.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { emitReadOperandU32, emitWriteOperandU32 } from "./operands.js";
import { emitCompleteInstruction } from "./state.js";

export function emitMov(body: WasmFunctionBodyEncoder, instruction: DecodedInstruction): void {
  const destination = instruction.operands[0];
  const source = instruction.operands[1];
  const valueLocal = emitReadOperandU32(body, source);

  emitWriteOperandU32(body, destination, valueLocal);
  emitCompleteInstruction(body, instruction);
}
