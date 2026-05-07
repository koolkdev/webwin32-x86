import { widthMask, type RegisterAlias } from "#x86/isa/types.js";
import { i32 } from "#x86/state/cpu-state.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import {
  cleanValueWidth,
  dirtyValueWidth,
  emitSignExtendValueToWidth,
  emitMaskValueToWidth,
  type WasmIrEmitValueOptions,
  type ValueWidth
} from "#backends/wasm/codegen/value-width.js";
import {
  byteWidth,
  fullWidth,
  type LocalRegValueSource,
  type RegValueState
} from "./register-values.js";

export function emitStoreAliasValueIntoFullLocal(
  body: WasmFunctionBodyEncoder,
  fullLocal: number,
  alias: RegisterAlias,
  valueLocal: number
): void {
  const shiftedMask = (widthMask(alias.width) << alias.bitOffset) >>> 0;

  body.localGet(fullLocal).i32Const(i32(~shiftedMask)).i32And();
  body.localGet(valueLocal);

  if (alias.bitOffset !== 0) {
    body.i32Const(alias.bitOffset).i32Shl();
  }

  body.i32Or().localSet(fullLocal);
}

export function emitMergedPrefix(
  body: WasmFunctionBodyEncoder,
  state: RegValueState | undefined,
  options: Readonly<{ baseLocal?: number }> = {}
): void {
  if (state?.kind !== "local" || state.width === fullWidth) {
    return;
  }

  if (state.local === options.baseLocal) {
    return;
  }

  const prefixMask = widthMask(state.width);

  body.i32Const(i32(~prefixMask)).i32And();
  body.localGet(state.local).i32Or();
}

export function emitExtractAliasFromLocal(
  body: WasmFunctionBodyEncoder,
  source: LocalRegValueSource,
  alias: RegisterAlias,
  options: WasmIrEmitValueOptions = {}
): ValueWidth {
  body.localGet(source.local);

  if (alias.bitOffset !== 0) {
    body.i32Const(alias.bitOffset).i32ShrU();
  }

  if (options.signed === true && alias.width < fullWidth) {
    return emitSignExtendValueToWidth(body, alias.width as 8 | 16);
  }

  if (alias.bitOffset === 0 && source.width <= alias.width) {
    return cleanValueWidth(alias.width);
  }

  if (options.widthInsensitive === true && alias.width < fullWidth) {
    return dirtyValueWidth(alias.width);
  }

  return emitMaskValueToWidth(body, alias.width);
}

export function emitComposedPrefixLocal(
  body: WasmFunctionBodyEncoder,
  current: LocalRegValueSource,
  valueLocal: number,
  valueWidth: 8 | 16
): number {
  const local = body.addLocal(wasmValueType.i32);
  const replacementMask = widthMask(valueWidth);

  body.localGet(current.local).i32Const(i32(~replacementMask)).i32And();
  body.localGet(valueLocal).i32Or().localSet(local);
  return local;
}

export function offsetForAlias(alias: RegisterAlias): number {
  return alias.bitOffset / byteWidth;
}
