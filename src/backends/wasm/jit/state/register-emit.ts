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
  exactFullLocalSource,
  knownByteLocalSources,
  partialLaneLocalSources,
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
  if (exactFullLocalSource(state) !== undefined) {
    return;
  }

  const coveredBytes = new Set<number>();

  for (const lane of partialLaneLocalSources(state)) {
    if (lane.source.local === options.baseLocal && lane.source.bitOffset === lane.bitOffset) {
      continue;
    }

    emitMergedPartialLane(body, lane);

    const startByte = lane.bitOffset / byteWidth;
    const byteLength = lane.width / byteWidth;

    for (let index = 0; index < byteLength; index += 1) {
      coveredBytes.add(startByte + index);
    }
  }

  for (const [byteIndex, source] of knownByteLocalSources(state)) {
    if (coveredBytes.has(byteIndex)) {
      continue;
    }

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

function emitMergedPartialLane(
  body: WasmFunctionBodyEncoder,
  lane: Readonly<{
    bitOffset: RegisterAlias["bitOffset"];
    width: RegisterAlias["width"];
    source: LocalLaneSource;
  }>
): void {
  const shiftedMask = (widthMask(lane.width) << lane.bitOffset) >>> 0;

  body.i32Const(i32(~shiftedMask)).i32And();
  body.localGet(lane.source.local);

  if (lane.source.bitOffset !== 0) {
    body.i32Const(lane.source.bitOffset).i32ShrU();
  }

  if (lane.bitOffset !== 0) {
    body.i32Const(lane.bitOffset).i32Shl();
  }

  body.i32Or();
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
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];

    if (source === undefined) {
      throw new Error(`missing byte source: ${index}`);
    }

    emitLocalLaneSource(body, source);

    const shift = index * byteWidth;

    if (shift !== 0) {
      body.i32Const(shift).i32Shl();
    }

    if (index !== 0) {
      body.i32Or();
    }
  }
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
