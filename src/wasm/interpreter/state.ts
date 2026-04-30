import type { Reg32 } from "../../arch/x86/instruction/types.js";
import { stateOffset, wasmMemoryIndex } from "../abi.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";

export const stateU32Align = 2;

export function emitLoadStateU32(body: WasmFunctionBodyEncoder, offset: number): void {
  body.i32Const(0).i32Load({
    align: stateU32Align,
    memoryIndex: wasmMemoryIndex.state,
    offset
  });
}

export function emitStoreStateStackU32(body: WasmFunctionBodyEncoder, offset: number): void {
  body.i32Store({
    align: stateU32Align,
    memoryIndex: wasmMemoryIndex.state,
    offset
  });
}

export function emitLoadReg32(body: WasmFunctionBodyEncoder, reg: Reg32): void {
  emitLoadStateU32(body, stateOffset[reg]);
}

export function emitStoreReg32FromStack(body: WasmFunctionBodyEncoder, reg: Reg32): void {
  emitStoreStateStackU32(body, stateOffset[reg]);
}

export function emitOpcodeRegAddress(body: WasmFunctionBodyEncoder, opcodeLocal: number): void {
  body.localGet(opcodeLocal).i32Const(0b111).i32And().i32Const(2).i32Shl();
}

export function emitCompleteInstruction(
  body: WasmFunctionBodyEncoder,
  eipLocal: number,
  instructionLength: number
): void {
  body.i32Const(0).localGet(eipLocal).i32Const(instructionLength).i32Add();
  emitStoreStateStackU32(body, stateOffset.eip);
  emitIncrementInstructionCount(body);
}

function emitIncrementInstructionCount(body: WasmFunctionBodyEncoder): void {
  body.i32Const(0);
  emitLoadStateU32(body, stateOffset.instructionCount);
  body.i32Const(1).i32Add();
  emitStoreStateStackU32(body, stateOffset.instructionCount);
}
