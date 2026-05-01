import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";

export type WasmSirAluFlagsStorage = Readonly<{
  emitLoad(): void;
  emitStore(emitValue: () => void): void;
}>;

export function wasmSirLocalAluFlagsStorage(
  body: WasmFunctionBodyEncoder,
  local: number
): WasmSirAluFlagsStorage {
  return {
    emitLoad: () => {
      body.localGet(local);
    },
    emitStore: (emitValue) => {
      emitValue();
      body.localSet(local);
    }
  };
}
