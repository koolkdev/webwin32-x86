import { reg32, type Reg32 } from "../../arch/x86/instruction/types.js";
import { stateOffset, wasmMemoryIndex } from "../abi.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";

export const stateU32Align = 2;

export type InterpreterStateCache = Readonly<{
  eipLocal: number;
  eflagsLocal: number;
  instructionCountLocal: number;
  regs: Readonly<Record<Reg32, number>>;
}>;

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

export function createInterpreterStateCache(
  body: WasmFunctionBodyEncoder,
  eipLocal: number
): InterpreterStateCache {
  const regs = Object.fromEntries(
    reg32.map((reg) => [reg, body.addLocal(wasmValueType.i32)])
  ) as Record<Reg32, number>;

  return {
    eipLocal,
    eflagsLocal: body.addLocal(wasmValueType.i32),
    instructionCountLocal: body.addLocal(wasmValueType.i32),
    regs
  };
}

export function emitLoadInterpreterStateCache(body: WasmFunctionBodyEncoder, cache: InterpreterStateCache): void {
  for (const reg of reg32) {
    emitLoadStateU32(body, stateOffset[reg]);
    body.localSet(cache.regs[reg]);
  }

  emitLoadStateU32(body, stateOffset.eip);
  body.localSet(cache.eipLocal);

  emitLoadStateU32(body, stateOffset.eflags);
  body.localSet(cache.eflagsLocal);

  emitLoadStateU32(body, stateOffset.instructionCount);
  body.localSet(cache.instructionCountLocal);
}

export function emitFlushInterpreterStateCache(body: WasmFunctionBodyEncoder, cache: InterpreterStateCache): void {
  for (const reg of reg32) {
    emitStoreStateU32(body, stateOffset[reg], () => {
      body.localGet(cache.regs[reg]);
    });
  }

  emitStoreStateU32(body, stateOffset.eip, () => {
    body.localGet(cache.eipLocal);
  });
  emitStoreStateU32(body, stateOffset.eflags, () => {
    body.localGet(cache.eflagsLocal);
  });
  emitStoreStateU32(body, stateOffset.instructionCount, () => {
    body.localGet(cache.instructionCountLocal);
  });
}

export function emitLoadReg32(body: WasmFunctionBodyEncoder, cache: InterpreterStateCache, reg: Reg32): void {
  body.localGet(cache.regs[reg]);
}

export function emitCopyReg32FromIndexLocal(
  body: WasmFunctionBodyEncoder,
  cache: InterpreterStateCache,
  indexLocal: number,
  targetLocal: number
): void {
  body.i32Const(0).localSet(targetLocal);
  emitReg32IndexDispatch(body, indexLocal, (reg) => {
    body.localGet(cache.regs[reg]).localSet(targetLocal);
  });
}

export function emitStoreReg32ByIndexLocal(
  body: WasmFunctionBodyEncoder,
  cache: InterpreterStateCache,
  indexLocal: number,
  valueLocal: number
): void {
  emitReg32IndexDispatch(body, indexLocal, (reg) => {
    body.localGet(valueLocal).localSet(cache.regs[reg]);
  });
}

export function emitStoreReg32(
  body: WasmFunctionBodyEncoder,
  cache: InterpreterStateCache,
  reg: Reg32,
  emitValue: () => void
): void {
  emitValue();
  body.localSet(cache.regs[reg]);
}

export function emitOpcodeRegIndex(body: WasmFunctionBodyEncoder, opcodeLocal: number): void {
  body.localGet(opcodeLocal).i32Const(0b111).i32And();
}

export function emitModRmRmIndex(body: WasmFunctionBodyEncoder, modRmLocal: number): void {
  body.localGet(modRmLocal).i32Const(0b111).i32And();
}

export function emitCompleteInstruction(
  body: WasmFunctionBodyEncoder,
  cache: InterpreterStateCache,
  instructionLength: number
): void {
  emitCompleteInstructionWithTarget(body, cache, () => {
    body.localGet(cache.eipLocal).i32Const(instructionLength).i32Add();
  });
}

export function emitCompleteInstructionWithTarget(
  body: WasmFunctionBodyEncoder,
  cache: InterpreterStateCache,
  emitTarget: () => void
): void {
  emitTarget();
  body.localSet(cache.eipLocal);
  emitIncrementInstructionCount(body, cache);
}

function emitIncrementInstructionCount(body: WasmFunctionBodyEncoder, cache: InterpreterStateCache): void {
  body.localGet(cache.instructionCountLocal).i32Const(1).i32Add().localSet(cache.instructionCountLocal);
}

function emitReg32IndexDispatch(
  body: WasmFunctionBodyEncoder,
  indexLocal: number,
  emitCase: (reg: Reg32) => void
): void {
  body.block();

  for (const _reg of reg32) {
    body.block();
  }

  body.localGet(indexLocal).brTable(reg32IndexDispatchTable(), reg32.length);

  for (let index = reg32.length - 1; index >= 0; index -= 1) {
    const reg = reg32[index];

    if (reg === undefined) {
      continue;
    }

    body.endBlock();
    emitCase(reg);
    body.br(index);
  }

  body.endBlock();
}

function reg32IndexDispatchTable(): number[] {
  return reg32.map((_reg, index) => reg32.length - 1 - index);
}
