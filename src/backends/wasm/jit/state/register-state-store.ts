import type { Reg32 } from "#x86/isa/types.js";
import { stateOffset } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import {
  emitLoadStateU32,
  emitStoreStateU32
} from "#backends/wasm/codegen/state.js";
import {
  exactFullLocal,
  fullRegAccess,
  laneSourcesForAlias,
  type RegValueState
} from "./register-lanes.js";
import {
  emitComposedLocalLaneSources,
  emitLocalLaneSourceForStore8,
  emitMergedBytes,
  emitStoreStateU16,
  emitStoreStateU8,
  emitWordLocalLaneSourceForStore16
} from "./register-emit.js";
import { planRegisterExitStore, type RegisterStoreOp } from "./register-store-plan.js";

export function emitStoreRegState(
  body: WasmFunctionBodyEncoder,
  reg: Reg32,
  state: RegValueState
): void {
  const storePlan = planRegisterExitStore(state);

  if (storePlan.kind === "partial") {
    emitPartialStateStores(body, reg, storePlan.stores);
    return;
  }

  emitStoreStateU32(body, stateOffset[reg], () => {
    emitFullValueFromSnapshot(body, reg, state);
  });
}

function emitPartialStateStores(
  body: WasmFunctionBodyEncoder,
  reg: Reg32,
  stores: readonly RegisterStoreOp[]
): void {
  const baseOffset = stateOffset[reg];

  for (const store of stores) {
    if (store.kind === "store16") {
      emitStoreStateU16(body, baseOffset + store.byteIndex, () => {
        emitWordLocalLaneSourceForStore16(body, store.sources);
      });
      continue;
    }

    emitStoreStateU8(body, baseOffset + store.byteIndex, () => {
      emitLocalLaneSourceForStore8(body, store.source);
    });
  }
}

function emitFullValueFromSnapshot(
  body: WasmFunctionBodyEncoder,
  reg: Reg32,
  state: RegValueState
): void {
  const fullSource = exactFullLocal(state);

  if (fullSource !== undefined) {
    body.localGet(fullSource.local);
    return;
  }

  const sources = laneSourcesForAlias(state, fullRegAccess(reg));

  if (sources !== undefined) {
    emitComposedLocalLaneSources(body, sources);
    return;
  }

  emitLoadStateU32(body, stateOffset[reg]);
  emitMergedBytes(body, state);
}
