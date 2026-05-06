import { widthMask, type RegisterAlias } from "#x86/isa/types.js";
import { i32 } from "#x86/state/cpu-state.js";
import { wasmMemoryIndex } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import {
  cleanValueWidth,
  dirtyValueWidth,
  emitSignExtendValueToWidth,
  emitMaskValueToWidth,
  type WasmIrEmitValueOptions,
  type ValueWidth
} from "#backends/wasm/codegen/value-width.js";
import {
  aliasMask,
  byteMask,
  byteWidth,
  exactFullLocal,
  knownByteLocalSources,
  type LocalLaneSource,
  type RegValueState
} from "./register-lanes.js";

export function emitStoreStateU8(
  body: WasmFunctionBodyEncoder,
  offset: number,
  emitValue: () => void
): void {
  body.i32Const(0);
  emitValue();
  body.i32Store8({
    align: 0,
    memoryIndex: wasmMemoryIndex.state,
    offset
  });
}

export function emitStoreStateU16(
  body: WasmFunctionBodyEncoder,
  offset: number,
  emitValue: () => void
): void {
  body.i32Const(0);
  emitValue();
  body.i32Store16({
    align: offset % 2 === 0 ? 1 : 0,
    memoryIndex: wasmMemoryIndex.state,
    offset
  });
}

export function emitStoreAliasValueIntoFullLocal(
  body: WasmFunctionBodyEncoder,
  fullLocal: number,
  alias: RegisterAlias,
  valueLocal: number
): void {
  const shiftedMask = aliasMask(alias);

  body.localGet(fullLocal).i32Const(i32(~shiftedMask)).i32And();
  body.localGet(valueLocal);

  if (alias.bitOffset !== 0) {
    body.i32Const(alias.bitOffset).i32Shl();
  }

  body.i32Or().localSet(fullLocal);
}

export function emitMergedBytes(
  body: WasmFunctionBodyEncoder,
  state: RegValueState,
  options: Readonly<{ baseLocal?: number }> = {}
): void {
  if (exactFullLocal(state) !== undefined) {
    return;
  }

  for (const [byteIndex, source] of knownByteLocalSources(state)) {
    const shift = byteIndex * byteWidth;

    if (source.local === options.baseLocal && source.bitOffset === shift) {
      continue;
    }

    const shiftedMask = byteMask << shift;

    body.i32Const(i32(~shiftedMask)).i32And();
    emitLocalLaneSource(body, source);

    if (shift !== 0) {
      body.i32Const(shift).i32Shl();
    }

    body.i32Or();
  }
}

export function emitExtractAliasFromLocal(
  body: WasmFunctionBodyEncoder,
  local: number,
  alias: RegisterAlias,
  options: WasmIrEmitValueOptions = {}
): ValueWidth {
  body.localGet(local);

  if (alias.bitOffset !== 0) {
    body.i32Const(alias.bitOffset).i32ShrU();
  }

  if (options.signed === true && alias.width < 32) {
    return emitSignExtendValueToWidth(body, alias.width as 8 | 16);
  }

  if (options.widthInsensitive === true && alias.width < 32) {
    return dirtyValueWidth(alias.width);
  }

  emitMaskValueToWidth(body, alias.width);
  return cleanValueWidth(alias.width);
}

export function emitComposedLocalLaneSources(
  body: WasmFunctionBodyEncoder,
  sources: readonly LocalLaneSource[]
): void {
  let index = 0;
  let emittedGroups = 0;

  while (index < sources.length) {
    const source = sources[index];

    if (source === undefined) {
      throw new Error(`missing byte source: ${index}`);
    }

    const groupByteLength = contiguousSourceByteLength(sources, index);
    const groupWidth = groupByteLength * byteWidth;

    emitLocalLaneSourceGroup(body, source, groupWidth);

    const shift = index * byteWidth;

    if (shift !== 0) {
      body.i32Const(shift).i32Shl();
    }

    if (emittedGroups !== 0) {
      body.i32Or();
    }

    emittedGroups += 1;
    index += groupByteLength;
  }
}

function contiguousSourceByteLength(sources: readonly LocalLaneSource[], startIndex: number): number {
  const first = sources[startIndex];

  if (first === undefined) {
    return 0;
  }

  let byteLength = 1;

  while (startIndex + byteLength < sources.length) {
    const source = sources[startIndex + byteLength];

    if (
      source === undefined ||
      source.local !== first.local ||
      source.valueWidth !== first.valueWidth ||
      source.bitOffset !== first.bitOffset + byteLength * byteWidth
    ) {
      break;
    }

    byteLength += 1;
  }

  return byteLength;
}

function emitLocalLaneSourceGroup(
  body: WasmFunctionBodyEncoder,
  source: LocalLaneSource,
  groupWidth: number
): void {
  body.localGet(source.local);

  if (source.bitOffset !== 0) {
    body.i32Const(source.bitOffset).i32ShrU();
  }

  if (groupWidth < 32 && source.bitOffset + groupWidth < source.valueWidth) {
    body.i32Const(laneGroupMask(groupWidth)).i32And();
  }
}

function laneGroupMask(width: number): number {
  return width === 24 ? 0x00ff_ffff : widthMask(width as 8 | 16);
}

export function emitWordLocalLaneSourceForStore16(
  body: WasmFunctionBodyEncoder,
  sources: readonly [LocalLaneSource, LocalLaneSource]
): void {
  const [lowByte, highByte] = sources;

  if (highByte.local === lowByte.local && highByte.bitOffset === lowByte.bitOffset + byteWidth) {
    body.localGet(lowByte.local);

    if (lowByte.bitOffset !== 0) {
      body.i32Const(lowByte.bitOffset).i32ShrU();
    }

    return;
  }

  emitComposedLocalLaneSources(body, sources);
}

export function emitLocalLaneSource(body: WasmFunctionBodyEncoder, source: LocalLaneSource): void {
  body.localGet(source.local);

  if (source.bitOffset !== 0) {
    body.i32Const(source.bitOffset).i32ShrU();
  }

  body.i32Const(byteMask).i32And();
}

export function emitLocalLaneSourceForStore8(body: WasmFunctionBodyEncoder, source: LocalLaneSource): void {
  body.localGet(source.local);

  if (source.bitOffset !== 0) {
    body.i32Const(source.bitOffset).i32ShrU();
  }
}
