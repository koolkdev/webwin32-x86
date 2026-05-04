import { wasmMemoryIndex } from "#backends/wasm/abi.js";
import { wasmBranchHint, type WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { ExitReason } from "#backends/wasm/exit.js";
import { emitWasmIrExitFromI32Stack, type WasmIrExitTarget } from "./exit.js";

type WasmIrMemoryAccess = "read" | "write";

const u32ByteLength = 4;
const u32Align = 2;
const wasmPageShift = 16;

export type WasmIrMemoryContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  exit: WasmIrExitTarget;
}>;

export function emitWasmIrLoadGuestU32(
  context: WasmIrMemoryContext,
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

export function emitWasmIrLoadGuestU32FromStack(
  context: WasmIrMemoryContext,
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

export function emitWasmIrStoreGuestU32(
  context: WasmIrMemoryContext,
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
  context: WasmIrMemoryContext,
  addressLocal: number,
  access: WasmIrMemoryAccess,
  faultExtraDepth: number
): void {
  emitLastValidGuestU32Address(context.body);
  context.body.localGet(addressLocal).i32LtU().ifBlock(wasmBranchHint.unlikely);
  context.body.localGet(addressLocal);
  emitWasmIrMemoryFaultExitFromI32Stack(context, access, faultExtraDepth);
  context.body.endBlock();
}

function emitFaultIfStackU32OutOfBounds(
  context: WasmIrMemoryContext,
  addressLocal: number,
  access: WasmIrMemoryAccess,
  faultExtraDepth: number
): void {
  context.body.localTee(addressLocal);
  emitLastValidGuestU32Address(context.body);
  context.body.i32GtU().ifBlock(wasmBranchHint.unlikely);
  context.body.localGet(addressLocal);
  emitWasmIrMemoryFaultExitFromI32Stack(context, access, faultExtraDepth);
  context.body.endBlock();
}

function emitLastValidGuestU32Address(body: WasmFunctionBodyEncoder): void {
  body.memorySize(wasmMemoryIndex.guest).i32Const(wasmPageShift).i32Shl().i32Const(u32ByteLength).i32Sub();
}

function emitWasmIrMemoryFaultExitFromI32Stack(
  context: WasmIrMemoryContext,
  access: WasmIrMemoryAccess,
  extraDepth: number
): void {
  emitWasmIrExitFromI32Stack(
    context.body,
    context.exit,
    access === "read" ? ExitReason.MEMORY_READ_FAULT : ExitReason.MEMORY_WRITE_FAULT,
    extraDepth
  );
}
