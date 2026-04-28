import type { DecodeReader } from "../../../arch/x86/block-decoder/decode-reader.js";
import type { GuestMemory } from "../../../core/memory/guest-memory.js";
import type { CpuState } from "../../../core/state/cpu-state.js";
import type { DecodedBlockCache } from "../../decoded-block-cache/decoded-block-cache.js";
import type { DecodedBlockRunner } from "../../decoded-block-runner/decoded-block-runner.js";
import type { WasmRuntimeContext } from "../../wasm-block/wasm-runtime-context.js";

export type RuntimeTierExecutionContext = Readonly<{
  state: CpuState;
  guestMemory: GuestMemory;
  decodeReader: DecodeReader;
  decodedBlockCache: DecodedBlockCache;
  decodedBlockRunner: DecodedBlockRunner;
  wasmRuntime?: WasmRuntimeContext;
}>;
