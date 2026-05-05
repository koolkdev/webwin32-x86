import { i32, widthMask } from "#x86/state/cpu-state.js";
import type { OperandWidth, RegisterAlias, Reg32 } from "#x86/isa/types.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";

export type WasmIrReg32Storage = Readonly<{
  emitGet(reg: Reg32): void;
  emitSet(reg: Reg32, emitValue: () => void): void;
}>;

export function wasmIrLocalReg32Storage(
  body: WasmFunctionBodyEncoder,
  locals: Readonly<Record<Reg32, number>>
): WasmIrReg32Storage {
  return {
    emitGet: (reg) => {
      body.localGet(locals[reg]);
    },
    emitSet: (reg, emitValue) => {
      emitValue();
      body.localSet(locals[reg]);
    }
  };
}

export function emitLoadRegAlias(
  body: WasmFunctionBodyEncoder,
  locals: Readonly<Record<Reg32, number>>,
  alias: RegisterAlias
): void {
  body.localGet(locals[alias.base]);
  emitExtractRegAliasFromStack(body, alias);
}

export function emitStoreRegAlias(
  body: WasmFunctionBodyEncoder,
  locals: Readonly<Record<Reg32, number>>,
  alias: RegisterAlias,
  emitValue: () => void
): void {
  if (alias.width === 32) {
    emitValue();
    body.localSet(locals[alias.base]);
    return;
  }

  const shiftedMask = widthMask(alias.width) << alias.bitOffset;

  body.localGet(locals[alias.base]).i32Const(i32(~shiftedMask)).i32And();
  emitValue();
  emitMaskValueToWidth(body, alias.width);

  if (alias.bitOffset !== 0) {
    body.i32Const(alias.bitOffset).i32Shl();
  }

  body.i32Or().localSet(locals[alias.base]);
}

export function emitLoadRegAccess(
  body: WasmFunctionBodyEncoder,
  locals: Readonly<Record<Reg32, number>>,
  reg: Reg32,
  width: OperandWidth
): void {
  body.localGet(locals[reg]);
  emitMaskValueToWidth(body, width);
}

export function emitStoreRegAccess(
  body: WasmFunctionBodyEncoder,
  locals: Readonly<Record<Reg32, number>>,
  reg: Reg32,
  width: OperandWidth,
  emitValue: () => void
): void {
  emitStoreRegAlias(body, locals, { name: reg, base: reg, bitOffset: 0, width }, emitValue);
}

export function emitExtractRegAliasFromStack(body: WasmFunctionBodyEncoder, alias: RegisterAlias): void {
  if (alias.bitOffset !== 0) {
    body.i32Const(alias.bitOffset).i32ShrU();
  }

  emitMaskValueToWidth(body, alias.width);
}

export function emitMaskValueToWidth(body: WasmFunctionBodyEncoder, width: OperandWidth): void {
  if (width === 32) {
    return;
  }

  body.i32Const(widthMask(width)).i32And();
}
