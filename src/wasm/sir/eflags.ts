import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";

export type WasmSirEflagsStorage = Readonly<{
  emitLoad(): void;
  emitStore(emitValue: () => void): void;
}>;

export function wasmSirLocalEflagsStorage(body: WasmFunctionBodyEncoder, local: number): WasmSirEflagsStorage {
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
