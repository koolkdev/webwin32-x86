import type { Reg32 } from "../arch/x86/instruction/types.js";
import { STATE_OFFSETS } from "../core/state/cpu-state.js";

export const wasmImport = {
  moduleName: "webwin32",
  stateMemoryName: "state",
  guestMemoryName: "guest"
} as const;

export const wasmMemoryIndex = {
  state: 0,
  guest: 1
} as const;

export const wasmBlockExportName = "run";

export const stateOffset = STATE_OFFSETS;

export function reg32StateOffset(reg: Reg32): number {
  return STATE_OFFSETS[reg];
}
