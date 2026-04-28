import type { DecodedInstruction, Operand } from "../../arch/x86/instruction/types.js";
import { i32 } from "../../core/state/cpu-state.js";
import { reg32StateOffset, stateOffset } from "../abi.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import { unsupportedWasmCodegen } from "./errors.js";
import { emitLoadGuestU32, emitStoreGuestU32 } from "./guest-memory.js";
import { emitCompleteInstruction, emitLoadStateU32, emitStoreStateStackU32 } from "./state.js";

export function emitPush(body: WasmFunctionBodyEncoder, instruction: DecodedInstruction): void {
  const value = emitPushOperandU32(body, instruction.operands[0]);
  const nextEsp = body.addLocal(wasmValueType.i32);

  emitLoadStateU32(body, stateOffset.esp);
  body.i32Const(4).i32Sub().localSet(nextEsp);

  emitStoreGuestU32(body, nextEsp, value);

  body.localGet(0).localGet(nextEsp);
  emitStoreStateStackU32(body, stateOffset.esp);
  emitCompleteInstruction(body, instruction);
}

export function emitPop(body: WasmFunctionBodyEncoder, instruction: DecodedInstruction): void {
  const destination = instruction.operands[0];

  if (destination?.kind !== "reg32") {
    unsupportedWasmCodegen("unsupported POP form for Wasm codegen");
  }

  const stackAddress = body.addLocal(wasmValueType.i32);
  const value = body.addLocal(wasmValueType.i32);
  const nextEsp = body.addLocal(wasmValueType.i32);

  emitLoadStateU32(body, stateOffset.esp);
  body.localTee(stackAddress).i32Const(4).i32Add().localSet(nextEsp);

  emitLoadGuestU32(body, stackAddress);
  body.localSet(value);

  body.localGet(0).localGet(value);
  emitStoreStateStackU32(body, reg32StateOffset(destination.reg));

  body.localGet(0).localGet(nextEsp);
  emitStoreStateStackU32(body, stateOffset.esp);
  emitCompleteInstruction(body, instruction);
}

function emitPushOperandU32(body: WasmFunctionBodyEncoder, operand: Operand | undefined): number {
  const value = body.addLocal(wasmValueType.i32);

  switch (operand?.kind) {
    case "reg32":
      emitLoadStateU32(body, reg32StateOffset(operand.reg));
      break;
    case "imm32":
      body.i32Const(i32(operand.value));
      break;
    case "imm8":
      body.i32Const(i32(operand.signedValue));
      break;
    default:
      unsupportedWasmCodegen("unsupported PUSH form for Wasm codegen");
  }

  body.localSet(value);
  return value;
}
