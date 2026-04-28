import type { Mem32Operand } from "../../arch/x86/instruction/types.js";
import { i32 } from "../../core/state/cpu-state.js";
import { reg32StateOffset } from "../abi.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { emitLoadStateU32 } from "./state.js";

const scaleShift = {
  1: 0,
  2: 1,
  4: 2,
  8: 3
} as const satisfies Readonly<Record<Mem32Operand["scale"], number>>;

export function emitEffectiveAddress(body: WasmFunctionBodyEncoder, operand: Mem32Operand): void {
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

function emitScale(body: WasmFunctionBodyEncoder, scale: Mem32Operand["scale"]): void {
  const shift = scaleShift[scale];

  if (shift !== 0) {
    body.i32Const(shift).i32Shl();
  }
}
