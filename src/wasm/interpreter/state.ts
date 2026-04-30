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

export function emitStoreStateU32(body: WasmFunctionBodyEncoder, offset: number, emitValue: () => void): void {
  body.i32Const(0);
  emitValue();
  emitStoreStateStackU32(body, offset);
}

export function emitLoadReg32(body: WasmFunctionBodyEncoder, reg: Reg32): void {
  emitLoadStateU32(body, stateOffset[reg]);
}

export function emitLoadReg32FromIndexLocal(body: WasmFunctionBodyEncoder, indexLocal: number): void {
  body.localGet(indexLocal).i32Const(2).i32Shl().i32Load({
    align: stateU32Align,
    memoryIndex: wasmMemoryIndex.state,
    offset: 0
  });
}

export function emitStoreReg32(body: WasmFunctionBodyEncoder, reg: Reg32, emitValue: () => void): void {
  emitStoreStateU32(body, stateOffset[reg], emitValue);
}

export function emitOpcodeRegAddress(body: WasmFunctionBodyEncoder, opcodeLocal: number): void {
  body.localGet(opcodeLocal).i32Const(0b111).i32And().i32Const(2).i32Shl();
}

export function emitModRmRegAddress(body: WasmFunctionBodyEncoder, modRmLocal: number): void {
  body.localGet(modRmLocal).i32Const(0b0011_1000).i32And().i32Const(1).i32ShrU();
}

export function emitModRmRmAddress(body: WasmFunctionBodyEncoder, modRmLocal: number): void {
  body.localGet(modRmLocal).i32Const(0b111).i32And().i32Const(2).i32Shl();
}

export function emitCompleteInstruction(
  body: WasmFunctionBodyEncoder,
  eipLocal: number,
  instructionLength: number
): void {
  emitCompleteInstructionWithTarget(body, eipLocal, () => {
    body.localGet(eipLocal).i32Const(instructionLength).i32Add();
  });
}

export function emitCompleteInstructionWithTarget(
  body: WasmFunctionBodyEncoder,
  eipLocal: number,
  emitTarget: () => void
): void {
  emitStoreStateU32(body, stateOffset.eip, () => {
    emitTarget();
    body.localTee(eipLocal);
  });
  emitIncrementInstructionCount(body);
}

function emitIncrementInstructionCount(body: WasmFunctionBodyEncoder): void {
  emitStoreStateU32(body, stateOffset.instructionCount, () => {
    emitLoadStateU32(body, stateOffset.instructionCount);
    body.i32Const(1).i32Add();
  });
}
