import type { RegisterAlias } from "#x86/isa/types.js";
import { stateOffset } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import {
  cleanValueWidth,
  dirtyValueWidth,
  emitMaskValueToWidth,
  emitSignExtendValueToWidth,
  type WasmIrEmitValueOptions,
  type ValueWidth
} from "#backends/wasm/codegen/value-width.js";
import {
  emitLoadStateS16,
  emitLoadStateS8,
  emitLoadStateU16,
  emitLoadStateU8
} from "#backends/wasm/codegen/state.js";
import {
  aliasByteRange,
  byteWidth,
  fullWidth,
  type LocalLaneSource
} from "./register-lanes.js";
import {
  emitComposedLocalLaneSources,
  emitExtractAliasFromLocal
} from "./register-emit.js";
import {
  currentByteUsesMutableCell,
  currentStableSourceAt,
  exactStableSourceForAlias,
  stableLaneSourcesForAlias
} from "./register-state-queries.js";
import type { RegisterStateStorage } from "./register-state-storage.js";
import type { RegisterValueEmitter } from "./register-value-emitter.js";

export function emitReadRegisterAlias(
  body: WasmFunctionBodyEncoder,
  storage: RegisterStateStorage,
  values: RegisterValueEmitter,
  alias: RegisterAlias,
  options: WasmIrEmitValueOptions = {}
): ValueWidth {
  const exactSource = exactStableSourceForAlias(storage, alias);

  if (exactSource !== undefined) {
    return emitExactSourceForAlias(body, exactSource, alias, options);
  }

  const localSources = stableLaneSourcesForAlias(storage, alias);

  if (localSources !== undefined) {
    emitComposedLocalLaneSources(body, localSources);
    return options.signed === true && alias.width < fullWidth
      ? emitSignExtendValueToWidth(body, alias.width as 8 | 16)
      : cleanValueWidth(alias.width);
  }

  if (canLoadAliasFromState(storage, alias)) {
    return emitLoadAliasFromState(body, alias, options);
  }

  const fullLocal = values.materializeCurrentFull(alias.base);

  return emitExtractAliasFromLocal(body, fullLocal, alias, options);
}

function canLoadAliasFromState(storage: RegisterStateStorage, alias: RegisterAlias): boolean {
  if (alias.width === fullWidth) {
    return false;
  }

  const { startByte, byteLength } = aliasByteRange(alias);

  for (let index = 0; index < byteLength; index += 1) {
    const byteIndex = startByte + index;

    if (
      currentStableSourceAt(storage, alias.base, byteIndex) !== undefined ||
      currentByteUsesMutableCell(storage, alias.base, byteIndex)
    ) {
      return false;
    }
  }

  return true;
}

function emitLoadAliasFromState(
  body: WasmFunctionBodyEncoder,
  alias: RegisterAlias,
  options: WasmIrEmitValueOptions
): ValueWidth {
  const offset = stateOffset[alias.base] + alias.bitOffset / byteWidth;

  switch (alias.width) {
    case 8:
      if (options.signed === true) {
        emitLoadStateS8(body, offset);
        return cleanValueWidth(fullWidth);
      }
      emitLoadStateU8(body, offset);
      return cleanValueWidth(8);
    case 16:
      if (options.signed === true) {
        emitLoadStateS16(body, offset);
        return cleanValueWidth(fullWidth);
      }
      emitLoadStateU16(body, offset);
      return cleanValueWidth(16);
    case 32:
      throw new Error("full-width aliases must use full state loads");
  }
}

function emitExactSourceForAlias(
  body: WasmFunctionBodyEncoder,
  source: LocalLaneSource,
  alias: RegisterAlias,
  options: WasmIrEmitValueOptions
): ValueWidth {
  body.localGet(source.local);

  if (source.bitOffset !== 0) {
    body.i32Const(source.bitOffset).i32ShrU();
  }

  if (options.signed === true && alias.width < fullWidth) {
    return emitSignExtendValueToWidth(body, alias.width as 8 | 16);
  }

  if (source.bitOffset === 0 && source.valueWidth <= alias.width) {
    return cleanValueWidth(alias.width);
  }

  if (options.widthInsensitive === true && alias.width < fullWidth) {
    return dirtyValueWidth(alias.width);
  }

  return emitMaskValueToWidth(body, alias.width);
}
