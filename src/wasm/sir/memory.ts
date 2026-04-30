import { wasmMemoryIndex } from "../abi.js";
import { wasmBranchHint, type WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { ExitReason } from "../exit.js";
import { emitWasmSirExitFromI32Stack, type WasmSirExitTarget } from "./exit.js";

type WasmSirMemoryAccess = "read" | "write";

const u32ByteLength = 4;
const u32Align = 2;
const wasmPageShift = 16;

export type WasmSirMemoryContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  exit: WasmSirExitTarget;
}>;

export function emitWasmSirLoadGuestU32(
  context: WasmSirMemoryContext,
  addressLocal: number,
  faultExtraDepth = 1
): void {
  emitFaultIfU32OutOfBounds(context, addressLocal, "read", faultExtraDepth);
  context.body.localGet(addressLocal).i32Load({
    align: u32Align,
    memoryIndex: wasmMemoryIndex.guest,
    offset: 0
  });
}

export function emitWasmSirLoadGuestU32FromStack(
  context: WasmSirMemoryContext,
  addressLocal: number,
  faultExtraDepth = 1
): void {
  emitFaultIfStackU32OutOfBounds(context, addressLocal, "read", faultExtraDepth);
  context.body.localGet(addressLocal).i32Load({
    align: u32Align,
    memoryIndex: wasmMemoryIndex.guest,
    offset: 0
  });
}

export function emitWasmSirStoreGuestU32(
  context: WasmSirMemoryContext,
  addressLocal: number,
  valueLocal: number,
  faultExtraDepth = 1
): void {
  emitFaultIfU32OutOfBounds(context, addressLocal, "write", faultExtraDepth);
  context.body.localGet(addressLocal).localGet(valueLocal).i32Store({
    align: u32Align,
    memoryIndex: wasmMemoryIndex.guest,
    offset: 0
  });
}

function emitFaultIfU32OutOfBounds(
  context: WasmSirMemoryContext,
  addressLocal: number,
  access: WasmSirMemoryAccess,
  faultExtraDepth: number
): void {
  emitLastValidGuestU32Address(context.body);
  context.body.localGet(addressLocal).i32LtU().ifBlock(wasmBranchHint.unlikely);
  context.body.localGet(addressLocal);
  emitWasmSirMemoryFaultExitFromI32Stack(context, access, faultExtraDepth);
  context.body.endBlock();
}

function emitFaultIfStackU32OutOfBounds(
  context: WasmSirMemoryContext,
  addressLocal: number,
  access: WasmSirMemoryAccess,
  faultExtraDepth: number
): void {
  context.body.localTee(addressLocal);
  emitLastValidGuestU32Address(context.body);
  context.body.i32GtU().ifBlock(wasmBranchHint.unlikely);
  context.body.localGet(addressLocal);
  emitWasmSirMemoryFaultExitFromI32Stack(context, access, faultExtraDepth);
  context.body.endBlock();
}

function emitLastValidGuestU32Address(body: WasmFunctionBodyEncoder): void {
  body.memorySize(wasmMemoryIndex.guest).i32Const(wasmPageShift).i32Shl().i32Const(u32ByteLength).i32Sub();
}

function emitWasmSirMemoryFaultExitFromI32Stack(
  context: WasmSirMemoryContext,
  access: WasmSirMemoryAccess,
  extraDepth: number
): void {
  emitWasmSirExitFromI32Stack(
    context.body,
    context.exit,
    access === "read" ? ExitReason.MEMORY_READ_FAULT : ExitReason.MEMORY_WRITE_FAULT,
    extraDepth
  );
}
