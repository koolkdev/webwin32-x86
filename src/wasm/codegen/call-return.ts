import { instructionEnd } from "../../arch/x86/instruction/address.js";
import { relativeTarget } from "../../arch/x86/instruction/operands.js";
import type { DecodedInstruction, Operand } from "../../arch/x86/instruction/types.js";
import { i32 } from "../../core/state/cpu-state.js";
import { stateOffset } from "../abi.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import { ExitReason } from "../exit.js";
import { emitExitResult, emitExitResultFromStackPayload } from "./exit.js";
import { unsupportedWasmCodegen } from "./errors.js";
import { emitLoadGuestU32, emitStoreGuestU32 } from "./guest-memory.js";
import type { WasmLocalScratchAllocator } from "./local-scratch.js";
import {
  emitCompleteAtEip,
  emitIncrementInstructionCount,
  emitLoadStateU32,
  emitStoreStateStackU32
} from "./state.js";

export function emitCall(
  body: WasmFunctionBodyEncoder,
  scratch: WasmLocalScratchAllocator,
  instruction: DecodedInstruction
): void {
  const target = relativeTarget(instruction);
  const returnAddress = scratch.allocLocal(wasmValueType.i32);
  const nextEsp = scratch.allocLocal(wasmValueType.i32);

  body.i32Const(i32(instructionEnd(instruction))).localSet(returnAddress);

  emitLoadStateU32(body, stateOffset.esp);
  body.i32Const(4).i32Sub().localSet(nextEsp);

  emitStoreGuestU32(body, nextEsp, returnAddress);

  body.localGet(0).localGet(nextEsp);
  emitStoreStateStackU32(body, stateOffset.esp);
  emitCompleteAtEip(body, target);
  emitExitResult(body, ExitReason.JUMP, target).returnFromFunction();
  scratch.freeLocal(nextEsp);
  scratch.freeLocal(returnAddress);
}

export function emitRet(
  body: WasmFunctionBodyEncoder,
  scratch: WasmLocalScratchAllocator,
  instruction: DecodedInstruction
): void {
  const cleanup = retCleanupBytes(instruction.operands[0]);

  if (cleanup === undefined) {
    unsupportedWasmCodegen("unsupported RET form for Wasm codegen");
  }

  const stackAddress = scratch.allocLocal(wasmValueType.i32);
  const target = scratch.allocLocal(wasmValueType.i32);
  const nextEsp = scratch.allocLocal(wasmValueType.i32);

  emitLoadStateU32(body, stateOffset.esp);
  body.localTee(stackAddress).i32Const(i32(4 + cleanup)).i32Add().localSet(nextEsp);

  emitLoadGuestU32(body, stackAddress);
  body.localSet(target);

  body.localGet(0).localGet(nextEsp);
  emitStoreStateStackU32(body, stateOffset.esp);

  body.localGet(0).localGet(target);
  emitStoreStateStackU32(body, stateOffset.eip);
  emitIncrementInstructionCount(body);

  body.localGet(target);
  emitExitResultFromStackPayload(body, ExitReason.JUMP).returnFromFunction();
  scratch.freeLocal(nextEsp);
  scratch.freeLocal(target);
  scratch.freeLocal(stackAddress);
}

function retCleanupBytes(operand: Operand | undefined): number | undefined {
  if (operand === undefined) {
    return 0;
  }

  return operand.kind === "imm16" ? operand.value : undefined;
}
