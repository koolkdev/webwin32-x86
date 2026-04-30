import type { Reg32 } from "../../arch/x86/isa/types.js";
import { reg32 } from "../../arch/x86/isa/types.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";

type Reg32Locals = Readonly<Record<Reg32, number>>;

export function emitCopyReg32FromIndexLocal(
  body: WasmFunctionBodyEncoder,
  regs: Reg32Locals,
  indexLocal: number,
  targetLocal: number
): void {
  emitLoadReg32ByIndexLocal(body, regs, indexLocal);
  body.localSet(targetLocal);
}

export function emitLoadReg32ByIndexLocal(
  body: WasmFunctionBodyEncoder,
  regs: Reg32Locals,
  indexLocal: number
): void {
  emitLoadReg32ByIndex(body, regs, () => {
    body.localGet(indexLocal);
  });
}

export function emitLoadReg32ByIndex(
  body: WasmFunctionBodyEncoder,
  regs: Reg32Locals,
  emitIndex: () => void
): void {
  const defaultCaseIndex = reg32.length;
  const caseCount = reg32.length + 1;

  body.block(wasmValueType.i32);

  for (let index = 0; index < caseCount; index += 1) {
    body.block();
  }

  emitIndex();
  body.brTable(reg32ValueDispatchTable(), 0);

  for (let caseIndex = caseCount - 1; caseIndex >= 0; caseIndex -= 1) {
    body.endBlock();

    if (caseIndex === defaultCaseIndex) {
      body.i32Const(0);
    } else {
      const reg = reg32[caseIndex];

      if (reg === undefined) {
        throw new Error(`missing register dispatch case: ${caseIndex}`);
      }

      body.localGet(regs[reg]);
    }

    body.br(caseIndex);
  }

  body.endBlock();
}

export function emitStoreReg32ByIndexLocal(
  body: WasmFunctionBodyEncoder,
  regs: Reg32Locals,
  indexLocal: number,
  valueLocal: number
): void {
  emitStoreReg32ByIndex(body, regs, () => {
    body.localGet(indexLocal);
  }, valueLocal);
}

export function emitStoreReg32ByIndex(
  body: WasmFunctionBodyEncoder,
  regs: Reg32Locals,
  emitIndex: () => void,
  valueLocal: number
): void {
  emitReg32IndexDispatch(body, emitIndex, (reg) => {
    body.localGet(valueLocal).localSet(regs[reg]);
  });
}

export function emitOpcodeRegIndex(body: WasmFunctionBodyEncoder, opcodeLocal: number): void {
  body.localGet(opcodeLocal).i32Const(0b111).i32And();
}

export function emitModRmRmIndex(body: WasmFunctionBodyEncoder, modRmLocal: number): void {
  body.localGet(modRmLocal).i32Const(0b111).i32And();
}

function emitReg32IndexDispatch(
  body: WasmFunctionBodyEncoder,
  emitIndex: () => void,
  emitCase: (reg: Reg32) => void
): void {
  body.block();

  for (const _reg of reg32) {
    body.block();
  }

  emitIndex();
  body.brTable(reg32IndexDispatchTable(), reg32.length);

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

function reg32ValueDispatchTable(): number[] {
  return reg32.map((_reg, index) => reg32.length - index);
}
