import type { RegisterAlias } from "#x86/isa/types.js";
import { stateOffset } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import {
  cleanValueWidth,
  type WasmIrEmitValueOptions,
  type ValueWidth
} from "#backends/wasm/codegen/value-width.js";
import {
  emitLoadStateS16,
  emitLoadStateS8,
  emitLoadStateU16,
  emitLoadStateU8
} from "#backends/wasm/codegen/state.js";
import { fullWidth } from "./register-values.js";
import {
  emitExtractAliasFromLocal,
  offsetForAlias
} from "./register-prefix-emit.js";
import {
  currentAliasCanLoadFromState,
  currentExactSourceForAlias,
  currentKnownPrefixForAlias,
  type RegisterStateStorage
} from "./register-storage.js";
import type { RegisterMaterializer } from "./register-materialization.js";

export function emitReadRegisterAlias(
  body: WasmFunctionBodyEncoder,
  storage: RegisterStateStorage,
  values: RegisterMaterializer,
  alias: RegisterAlias,
  options: WasmIrEmitValueOptions = {}
): ValueWidth {
  const exactSource = currentExactSourceForAlias(storage, alias);

  if (exactSource !== undefined) {
    return emitExtractAliasFromLocal(body, exactSource, alias, options);
  }

  const prefixSource = currentKnownPrefixForAlias(storage, alias);

  if (prefixSource !== undefined) {
    return emitExtractAliasFromLocal(body, prefixSource, alias, options);
  }

  if (alias.width !== fullWidth && currentAliasCanLoadFromState(storage, alias)) {
    return emitLoadAliasFromState(body, alias, options);
  }

  const fullLocal = values.materializeCurrentFull(alias.base);

  return emitExtractAliasFromLocal(body, { kind: "local", local: fullLocal, width: fullWidth }, alias, options);
}

function emitLoadAliasFromState(
  body: WasmFunctionBodyEncoder,
  alias: RegisterAlias,
  options: WasmIrEmitValueOptions
): ValueWidth {
  const offset = stateOffset[alias.base] + offsetForAlias(alias);

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
