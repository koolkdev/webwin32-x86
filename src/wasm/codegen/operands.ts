import type { Operand } from "../../arch/x86/instruction/types.js";
import { i32 } from "../../core/state/cpu-state.js";
import { reg32StateOffset } from "../abi.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import { emitEffectiveAddress } from "./effective-address.js";
import { unsupportedWasmCodegen } from "./errors.js";
import { emitLoadGuestU32, emitStoreGuestU32 } from "./guest-memory.js";
import { emitLoadStateU32, emitStoreStateStackU32 } from "./state.js";

export type ReadOperandU32Options = Readonly<{
  signExtendImm8?: boolean;
}>;

export function emitReadOperandU32(
  body: WasmFunctionBodyEncoder,
  operand: Operand | undefined,
  options: ReadOperandU32Options = {}
): number {
  const valueLocal = body.addLocal(wasmValueType.i32);

  switch (operand?.kind) {
    case "reg32":
      emitLoadStateU32(body, reg32StateOffset(operand.reg));
      break;
    case "imm32":
      body.i32Const(i32(operand.value));
      break;
    case "imm8":
      if (options.signExtendImm8 !== true) {
        unsupportedWasmCodegen("unsupported operand read for Wasm codegen");
      }

      body.i32Const(i32(operand.signedValue));
      break;
    case "mem32": {
      const addressLocal = emitAddressLocal(body, operand);
      emitLoadGuestU32(body, addressLocal);
      break;
    }
    default:
      unsupportedWasmCodegen("unsupported operand read for Wasm codegen");
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
      unsupportedWasmCodegen("unsupported operand write for Wasm codegen");
  }
}

function emitAddressLocal(body: WasmFunctionBodyEncoder, operand: Extract<Operand, { kind: "mem32" }>): number {
  const addressLocal = body.addLocal(wasmValueType.i32);

  emitEffectiveAddress(body, operand);
  body.localSet(addressLocal);
  return addressLocal;
}
