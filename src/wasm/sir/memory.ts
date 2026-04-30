import { emitLoadGuestU32, emitLoadGuestU32FromStack, emitStoreGuestU32 } from "../codegen/guest-memory.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { ExitReason } from "../exit.js";
import { emitWasmSirExit, type WasmSirExitTarget } from "./exit.js";

type WasmSirMemoryAccess = "read" | "write";

export type WasmSirMemoryContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  exit: WasmSirExitTarget;
}>;

export function emitWasmSirLoadGuestU32(
  context: WasmSirMemoryContext,
  addressLocal: number,
  faultExtraDepth = 1
): void {
  emitLoadGuestU32(context.body, addressLocal, (access: WasmSirMemoryAccess, emitPayload) => {
    emitWasmSirMemoryFaultExit(context, access, emitPayload, faultExtraDepth);
  });
}

export function emitWasmSirLoadGuestU32FromStack(
  context: WasmSirMemoryContext,
  addressLocal: number,
  faultExtraDepth = 1
): void {
  emitLoadGuestU32FromStack(context.body, addressLocal, (access: WasmSirMemoryAccess, emitPayload) => {
    emitWasmSirMemoryFaultExit(context, access, emitPayload, faultExtraDepth);
  });
}

export function emitWasmSirStoreGuestU32(
  context: WasmSirMemoryContext,
  addressLocal: number,
  valueLocal: number,
  faultExtraDepth = 1
): void {
  emitStoreGuestU32(context.body, addressLocal, valueLocal, (access: WasmSirMemoryAccess, emitPayload) => {
    emitWasmSirMemoryFaultExit(context, access, emitPayload, faultExtraDepth);
  });
}

export function emitWasmSirMemoryFaultExit(
  context: WasmSirMemoryContext,
  access: WasmSirMemoryAccess,
  emitPayload: () => void,
  extraDepth: number
): void {
  emitWasmSirExit(
    context.body,
    context.exit,
    access === "read" ? ExitReason.MEMORY_READ_FAULT : ExitReason.MEMORY_WRITE_FAULT,
    emitPayload,
    extraDepth
  );
}
