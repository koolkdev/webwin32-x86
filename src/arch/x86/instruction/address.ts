import { u32 } from "../../../core/state/cpu-state.js";
import type { DecodedInstruction } from "./types.js";

export function instructionEnd(instruction: DecodedInstruction): number {
  return u32(instruction.address + instruction.length);
}

