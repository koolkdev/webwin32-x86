import type { Mem32Operand } from "../../arch/x86/instruction/types.js";
import { i32 } from "../../core/state/cpu-state.js";
import { reg32StateOffset, wasmMemoryIndex } from "../abi.js";
import { wasmBranchHint, type WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { ExitReason } from "../exit.js";
import { emitExitResultFromStackPayload } from "./exit.js";
import { emitLoadStateU32 } from "./state.js";

const u32ByteLength = 4;
const u32Align = 2;
const wasmPageShift = 16;
const scaleShift = {
  1: 0,
  2: 1,
  4: 2,
  8: 3
} as const satisfies Readonly<Record<Mem32Operand["scale"], number>>;

export function emitMem32Address(body: WasmFunctionBodyEncoder, operand: Mem32Operand): void {
  let hasTerm = false;

  if (operand.base !== undefined) {
    emitLoadStateU32(body, reg32StateOffset(operand.base));
    hasTerm = true;
  }

  if (operand.index !== undefined) {
    emitLoadStateU32(body, reg32StateOffset(operand.index));
    emitScale(body, operand.scale);

    if (hasTerm) {
      body.i32Add();
    }

    hasTerm = true;
  }

  if (operand.disp !== 0 || !hasTerm) {
    body.i32Const(i32(operand.disp));

    if (hasTerm) {
      body.i32Add();
    }
  }
}

export function emitLoadGuestU32(body: WasmFunctionBodyEncoder, addressLocal: number): void {
  emitFaultIfU32OutOfBounds(body, addressLocal);
  body.localGet(addressLocal).i32Load({
    align: u32Align,
    memoryIndex: wasmMemoryIndex.guest,
    offset: 0
  });
}

export function emitStoreGuestU32(body: WasmFunctionBodyEncoder, addressLocal: number, valueLocal: number): void {
  emitFaultIfU32OutOfBounds(body, addressLocal);
  body.localGet(addressLocal).localGet(valueLocal).i32Store({
    align: u32Align,
    memoryIndex: wasmMemoryIndex.guest,
    offset: 0
  });
}

function emitScale(body: WasmFunctionBodyEncoder, scale: Mem32Operand["scale"]): void {
  const shift = scaleShift[scale];

  if (shift !== 0) {
    body.i32Const(shift).i32Shl();
  }
}

function emitFaultIfU32OutOfBounds(body: WasmFunctionBodyEncoder, addressLocal: number): void {
  emitLastValidGuestU32Address(body);
  body.localGet(addressLocal).i32LtU().ifBlock(wasmBranchHint.unlikely);
  body.localGet(addressLocal);
  emitExitResultFromStackPayload(body, ExitReason.MEMORY_FAULT).returnFromFunction().endBlock();
}

function emitLastValidGuestU32Address(body: WasmFunctionBodyEncoder): void {
  body.memorySize(wasmMemoryIndex.guest).i32Const(wasmPageShift).i32Shl().i32Const(u32ByteLength).i32Sub();
}
