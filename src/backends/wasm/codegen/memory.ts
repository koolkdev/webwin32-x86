import { wasmMemoryIndex } from "#backends/wasm/abi.js";
import { wasmBranchHint, type WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { ExitReason } from "#backends/wasm/exit.js";
import type { OperandWidth } from "#x86/isa/types.js";
import { emitWasmIrExitFromI32Stack, type WasmIrExitTarget } from "./exit.js";

type WasmIrMemoryAccess = "read" | "write";

const memoryWidthByteLength = {
  8: 1,
  16: 2,
  32: 4
} as const satisfies Readonly<Record<OperandWidth, number>>;

const memoryWidthAlign = {
  8: 0,
  16: 1,
  32: 2
} as const satisfies Readonly<Record<OperandWidth, number>>;

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
  emitWasmIrLoadGuest(context, addressLocal, 32, faultExtraDepth);
}

export function emitWasmIrLoadGuestU32FromStack(
  context: WasmIrMemoryContext,
  addressLocal: number,
  faultExtraDepth = 1
): void {
  emitWasmIrLoadGuestFromStack(context, addressLocal, 32, faultExtraDepth);
}

export function emitWasmIrStoreGuestU32(
  context: WasmIrMemoryContext,
  addressLocal: number,
  valueLocal: number,
  faultExtraDepth = 1
): void {
  emitWasmIrStoreGuest(context, addressLocal, valueLocal, 32, faultExtraDepth);
}

export function emitWasmIrLoadGuest(
  context: WasmIrMemoryContext,
  addressLocal: number,
  width: OperandWidth,
  faultExtraDepth = 1
): void {
  emitFaultIfOutOfBounds(context, addressLocal, width, "read", faultExtraDepth);
  emitGuestLoad(context.body, addressLocal, width);
}

export function emitWasmIrLoadGuestFromStack(
  context: WasmIrMemoryContext,
  addressLocal: number,
  width: OperandWidth,
  faultExtraDepth = 1
): void {
  emitFaultIfStackOutOfBounds(context, addressLocal, width, "read", faultExtraDepth);
  emitGuestLoad(context.body, addressLocal, width);
}

export function emitWasmIrStoreGuest(
  context: WasmIrMemoryContext,
  addressLocal: number,
  valueLocal: number,
  width: OperandWidth,
  faultExtraDepth = 1
): void {
  emitFaultIfOutOfBounds(context, addressLocal, width, "write", faultExtraDepth);
  emitGuestStore(context.body, addressLocal, valueLocal, width);
}

function emitFaultIfOutOfBounds(
  context: WasmIrMemoryContext,
  addressLocal: number,
  width: OperandWidth,
  access: WasmIrMemoryAccess,
  faultExtraDepth: number
): void {
  emitLastValidGuestAddress(context.body, width);
  context.body.localGet(addressLocal).i32LtU().ifBlock(wasmBranchHint.unlikely);
  context.body.localGet(addressLocal);
  emitWasmIrMemoryFaultExitFromI32Stack(context, access, width, faultExtraDepth);
  context.body.endBlock();
}

function emitFaultIfStackOutOfBounds(
  context: WasmIrMemoryContext,
  addressLocal: number,
  width: OperandWidth,
  access: WasmIrMemoryAccess,
  faultExtraDepth: number
): void {
  context.body.localTee(addressLocal);
  emitLastValidGuestAddress(context.body, width);
  context.body.i32GtU().ifBlock(wasmBranchHint.unlikely);
  context.body.localGet(addressLocal);
  emitWasmIrMemoryFaultExitFromI32Stack(context, access, width, faultExtraDepth);
  context.body.endBlock();
}

function emitLastValidGuestAddress(body: WasmFunctionBodyEncoder, width: OperandWidth): void {
  body
    .memorySize(wasmMemoryIndex.guest)
    .i32Const(wasmPageShift)
    .i32Shl()
    .i32Const(memoryWidthByteLength[width])
    .i32Sub();
}

function emitGuestLoad(body: WasmFunctionBodyEncoder, addressLocal: number, width: OperandWidth): void {
  const immediate = {
    align: memoryWidthAlign[width],
    memoryIndex: wasmMemoryIndex.guest,
    offset: 0
  };

  body.localGet(addressLocal);

  switch (width) {
    case 8:
      body.i32Load8U(immediate);
      return;
    case 16:
      body.i32Load16U(immediate);
      return;
    case 32:
      body.i32Load(immediate);
      return;
  }
}

function emitGuestStore(
  body: WasmFunctionBodyEncoder,
  addressLocal: number,
  valueLocal: number,
  width: OperandWidth
): void {
  const immediate = {
    align: memoryWidthAlign[width],
    memoryIndex: wasmMemoryIndex.guest,
    offset: 0
  };

  body.localGet(addressLocal).localGet(valueLocal);

  switch (width) {
    case 8:
      body.i32Store8(immediate);
      return;
    case 16:
      body.i32Store16(immediate);
      return;
    case 32:
      body.i32Store(immediate);
      return;
  }
}

function emitWasmIrMemoryFaultExitFromI32Stack(
  context: WasmIrMemoryContext,
  access: WasmIrMemoryAccess,
  width: OperandWidth,
  extraDepth: number
): void {
  emitWasmIrExitFromI32Stack(
    context.body,
    context.exit,
    memoryFaultExitReason(access),
    extraDepth,
    memoryWidthByteLength[width]
  );
}

function memoryFaultExitReason(access: WasmIrMemoryAccess): ExitReason {
  switch (access) {
    case "read":
      return ExitReason.MEMORY_READ_FAULT;
    case "write":
      return ExitReason.MEMORY_WRITE_FAULT;
  }
}
