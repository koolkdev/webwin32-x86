import { wasmMemoryIndex } from "../abi.js";
import { wasmBranchHint, type WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { ExitReason } from "../exit.js";
import { emitExitResultFromStackPayload } from "./exit.js";

const u32ByteLength = 4;
const u32Align = 2;
const wasmPageShift = 16;
type GuestMemoryAccess = "read" | "write";
type GuestMemoryFaultHandler = (access: GuestMemoryAccess, emitPayload: () => void) => void;

export function emitLoadGuestU32(
  body: WasmFunctionBodyEncoder,
  addressLocal: number,
  faultHandler?: GuestMemoryFaultHandler
): void {
  emitFaultIfU32OutOfBounds(body, addressLocal, "read", faultHandler);
  body.localGet(addressLocal).i32Load({
    align: u32Align,
    memoryIndex: wasmMemoryIndex.guest,
    offset: 0
  });
}

export function emitStoreGuestU32(
  body: WasmFunctionBodyEncoder,
  addressLocal: number,
  valueLocal: number,
  faultHandler?: GuestMemoryFaultHandler
): void {
  emitFaultIfU32OutOfBounds(body, addressLocal, "write", faultHandler);
  body.localGet(addressLocal).localGet(valueLocal).i32Store({
    align: u32Align,
    memoryIndex: wasmMemoryIndex.guest,
    offset: 0
  });
}

function emitFaultIfU32OutOfBounds(
  body: WasmFunctionBodyEncoder,
  addressLocal: number,
  access: GuestMemoryAccess,
  faultHandler?: GuestMemoryFaultHandler
): void {
  emitLastValidGuestU32Address(body);
  body.localGet(addressLocal).i32LtU().ifBlock(wasmBranchHint.unlikely);
  if (faultHandler === undefined) {
    body.localGet(addressLocal);
    emitExitResultFromStackPayload(body, memoryFaultExitReason(access)).returnFromFunction();
  } else {
    faultHandler(access, () => {
      body.localGet(addressLocal);
    });
  }
  body.endBlock();
}

function emitLastValidGuestU32Address(body: WasmFunctionBodyEncoder): void {
  body.memorySize(wasmMemoryIndex.guest).i32Const(wasmPageShift).i32Shl().i32Const(u32ByteLength).i32Sub();
}

function memoryFaultExitReason(access: GuestMemoryAccess): ExitReason {
  return access === "read" ? ExitReason.MEMORY_READ_FAULT : ExitReason.MEMORY_WRITE_FAULT;
}
