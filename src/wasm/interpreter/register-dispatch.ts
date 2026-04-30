import type { Reg32 } from "../../arch/x86/instruction/types.js";
import { reg32 } from "../../arch/x86/instruction/types.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";

type Reg32Locals = Readonly<Record<Reg32, number>>;

export function emitCopyReg32FromIndexLocal(
  body: WasmFunctionBodyEncoder,
  regs: Reg32Locals,
  indexLocal: number,
  targetLocal: number
): void {
  body.i32Const(0).localSet(targetLocal);
  emitReg32IndexDispatch(body, indexLocal, (reg) => {
    body.localGet(regs[reg]).localSet(targetLocal);
  });
}

export function emitStoreReg32ByIndexLocal(
  body: WasmFunctionBodyEncoder,
  regs: Reg32Locals,
  indexLocal: number,
  valueLocal: number
): void {
  emitReg32IndexDispatch(body, indexLocal, (reg) => {
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
