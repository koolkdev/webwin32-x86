import type { RuntimeDecodeReader } from "../../../arch/x86/isa/runtime/decode-reader.js";
import type { GuestMemory } from "../../../core/memory/guest-memory.js";
import type { CpuState } from "../../../core/state/cpu-state.js";
import type { WasmRuntimeContext } from "../../wasm-block/wasm-runtime-context.js";
import type { WasmInterpreterRuntime } from "../../../wasm/interpreter/runtime.js";

export type RuntimeTierExecutionContext = Readonly<{
  state: CpuState;
  guestMemory: GuestMemory;
  decodeReader: RuntimeDecodeReader;
  wasmInterpreterRuntime?: WasmInterpreterRuntime;
  wasmRuntime?: WasmRuntimeContext;
}>;
