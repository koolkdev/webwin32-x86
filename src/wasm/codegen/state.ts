import { instructionEnd } from "../../arch/x86/instruction/address.js";
import type { DecodedInstruction } from "../../arch/x86/instruction/types.js";
import { i32 } from "../../core/state/cpu-state.js";
import { stateOffset, wasmMemoryIndex } from "../abi.js";
import { WasmFunctionBodyEncoder } from "../encoder/function-body.js";

export const u32Align = 2;

export function emitCompleteInstruction(body: WasmFunctionBodyEncoder, instruction: DecodedInstruction): void {
  emitCompleteAtEip(body, instructionEnd(instruction));
}

export function emitCompleteAtEip(body: WasmFunctionBodyEncoder, eip: number): void {
  emitStoreStateConstU32(body, stateOffset.eip, eip);
  emitIncrementInstructionCount(body);
}

export function emitStoreStateConstU32(body: WasmFunctionBodyEncoder, offset: number, value: number): void {
  body
    .localGet(0)
    .i32Const(i32(value));
  emitStoreStateStackU32(body, offset);
}

export function emitLoadStateU32(body: WasmFunctionBodyEncoder, offset: number): void {
  body
    .localGet(0)
    .i32Load({
      align: u32Align,
      memoryIndex: wasmMemoryIndex.state,
      offset
    });
}

export function emitStoreStateStackU32(body: WasmFunctionBodyEncoder, offset: number): void {
  body.i32Store({
    align: u32Align,
    memoryIndex: wasmMemoryIndex.state,
    offset
  });
}

function emitIncrementInstructionCount(body: WasmFunctionBodyEncoder): void {
  body.localGet(0);
  emitLoadStateU32(body, stateOffset.instructionCount);
  body
    .i32Const(1)
    .i32Add();
  emitStoreStateStackU32(body, stateOffset.instructionCount);
}
