import type { Reg32 } from "../../x86/isa/types.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";

export type WasmIrReg32Storage = Readonly<{
  emitGet(reg: Reg32): void;
  emitSet(reg: Reg32, emitValue: () => void): void;
}>;

export function wasmIrLocalReg32Storage(
  body: WasmFunctionBodyEncoder,
  locals: Readonly<Record<Reg32, number>>
): WasmIrReg32Storage {
  return {
    emitGet: (reg) => {
      body.localGet(locals[reg]);
    },
    emitSet: (reg, emitValue) => {
      emitValue();
      body.localSet(locals[reg]);
    }
  };
}
