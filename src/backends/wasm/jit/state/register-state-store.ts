import type { Reg32 } from "#x86/isa/types.js";
import { stateOffset } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { emitStoreStateU32 } from "#backends/wasm/codegen/state.js";
import type { RegValueState } from "./register-values.js";
import {
  emitLocalPrefixForStore,
  emitStoreStateU16,
  emitStoreStateU8
} from "./register-emit.js";

export function emitStoreRegState(
  body: WasmFunctionBodyEncoder,
  reg: Reg32,
  state: RegValueState
): void {
  const offset = stateOffset[reg];

  if (state.kind === "unknown") {
    return;
  }

  switch (state.width) {
    case 8:
      emitStoreStateU8(body, offset, () => {
        emitLocalPrefixForStore(body, state);
      });
      return;
    case 16:
      emitStoreStateU16(body, offset, () => {
        emitLocalPrefixForStore(body, state);
      });
      return;
    case 32:
      emitStoreStateU32(body, offset, () => {
        emitLocalPrefixForStore(body, state);
      });
      return;
  }
}
