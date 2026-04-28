import type { Operand } from "../../arch/x86/instruction/types.js";
import { i32 } from "../../core/state/cpu-state.js";
import { reg32StateOffset } from "../abi.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import { emitLoadGuestU32, emitMem32Address, emitStoreGuestU32 } from "./guest-memory.js";
import { emitLoadStateU32, emitStoreStateStackU32 } from "./state.js";

export function emitReadOperandU32(body: WasmFunctionBodyEncoder, operand: Operand | undefined): number {
  const valueLocal = body.addLocal(wasmValueType.i32);

  switch (operand?.kind) {
    case "reg32":
      emitLoadStateU32(body, reg32StateOffset(operand.reg));
      break;
    case "imm32":
      body.i32Const(i32(operand.value));
      break;
    case "mem32": {
      const addressLocal = emitAddressLocal(body, operand);
      emitLoadGuestU32(body, addressLocal);
      break;
    }
    default:
      throw new Error("unsupported operand read for Wasm codegen");
  }

  body.localSet(valueLocal);
  return valueLocal;
}

export function emitWriteOperandU32(
  body: WasmFunctionBodyEncoder,
  operand: Operand | undefined,
  valueLocal: number
): void {
  switch (operand?.kind) {
    case "reg32":
      body.localGet(0).localGet(valueLocal);
      emitStoreStateStackU32(body, reg32StateOffset(operand.reg));
      return;
    case "mem32": {
      const addressLocal = emitAddressLocal(body, operand);
      emitStoreGuestU32(body, addressLocal, valueLocal);
      return;
    }
    default:
      throw new Error("unsupported operand write for Wasm codegen");
  }
}

function emitAddressLocal(body: WasmFunctionBodyEncoder, operand: Extract<Operand, { kind: "mem32" }>): number {
  const addressLocal = body.addLocal(wasmValueType.i32);

  emitMem32Address(body, operand);
  body.localSet(addressLocal);
  return addressLocal;
}
