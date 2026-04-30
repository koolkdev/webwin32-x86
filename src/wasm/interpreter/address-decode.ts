import { reg32 } from "../../arch/x86/instruction/types.js";
import type { OperandSpec } from "../../arch/x86/isa/schema/types.js";
import type { InterpreterOperandBinding } from "../sir/interpreter-context.js";
import { wasmValueType } from "../encoder/types.js";
import {
  advanceDecodeReader,
  emitReadGuestByte,
  emitReadGuestU32,
  localDecodeReader,
  materializeDecodeReader,
  type DecodeReader
} from "./decode-reader.js";
import type { InterpreterHandlerContext } from "./handler-context.js";
import { emitLoadReg32, emitLoadReg32FromIndexLocal } from "./state.js";

export function decodeModRmRmOperand(
  operand: Extract<OperandSpec, { kind: "modrm.rm" }>,
  decodeReader: DecodeReader,
  context: InterpreterHandlerContext,
  modRmLocal: number,
  modRmByte: number
): Readonly<{ binding: InterpreterOperandBinding; nextDecodeReader: DecodeReader; scratchLocals: readonly number[] }> {
  const mod = modRmByte >>> 6;

  if (mod === 0b11) {
    if (operand.type === "m32") {
      throw new Error("m32 operand cannot bind to register ModRM form");
    }

    return {
      binding: { kind: "modrm.rm32", modRmLocal },
      nextDecodeReader: decodeReader,
      scratchLocals: []
    };
  }

  const addressLocal = context.scratch.allocLocal(wasmValueType.i32);
  const decoded = decodeMemoryAddress(mod, modRmByte & 0b111, decodeReader, context, addressLocal);

  return {
    binding: { kind: "mem32", addressLocal },
    nextDecodeReader: decoded.nextDecodeReader,
    scratchLocals: [addressLocal, ...decoded.scratchLocals]
  };
}

function decodeMemoryAddress(
  mod: number,
  rm: number,
  decodeReader: DecodeReader,
  context: InterpreterHandlerContext,
  addressLocal: number
): Readonly<{ nextDecodeReader: DecodeReader; scratchLocals: readonly number[] }> {
  return rm === 0b100
    ? decodeSibMemoryAddress(mod, decodeReader, context, addressLocal)
    : decodeNonSibMemoryAddress(mod, rm, decodeReader, context, addressLocal);
}

function decodeNonSibMemoryAddress(
  mod: number,
  rm: number,
  decodeReader: DecodeReader,
  context: InterpreterHandlerContext,
  addressLocal: number
): Readonly<{ nextDecodeReader: DecodeReader; scratchLocals: readonly number[] }> {
  switch (mod) {
    case 0:
      if (rm === 0b101) {
        loadDisplacementIntoAddress(32, decodeReader, context, addressLocal);
        return { nextDecodeReader: advanceDecodeReader(decodeReader, 4, context), scratchLocals: [] };
      }

      emitLoadReg32(context.body, reg32FromIndex(rm));
      context.body.localSet(addressLocal);
      return { nextDecodeReader: decodeReader, scratchLocals: [] };
    case 1:
      emitLoadReg32(context.body, reg32FromIndex(rm));
      context.body.localSet(addressLocal);
      addDisplacementToAddress(8, decodeReader, context, addressLocal);
      return { nextDecodeReader: advanceDecodeReader(decodeReader, 1, context), scratchLocals: [] };
    case 2:
      emitLoadReg32(context.body, reg32FromIndex(rm));
      context.body.localSet(addressLocal);
      addDisplacementToAddress(32, decodeReader, context, addressLocal);
      return { nextDecodeReader: advanceDecodeReader(decodeReader, 4, context), scratchLocals: [] };
    default:
      throw new Error(`unsupported memory ModRM mod field: ${mod}`);
  }
}

function decodeSibMemoryAddress(
  mod: number,
  decodeReader: DecodeReader,
  context: InterpreterHandlerContext,
  addressLocal: number
): Readonly<{ nextDecodeReader: DecodeReader; scratchLocals: readonly number[] }> {
  const sibLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitReadGuestByte(context, decodeReader, sibLocal);
    const afterSibOffset = advanceDecodeReader(decodeReader, 1, context);

    context.body.i32Const(0).localSet(addressLocal);
    addSibIndexToAddress(context, sibLocal, addressLocal);

    switch (mod) {
      case 0:
        return decodeSibNoDisplacementBase(afterSibOffset, context, sibLocal, addressLocal);
      case 1:
        addSibBaseToAddress(context, sibLocal, addressLocal);
        addDisplacementToAddress(8, afterSibOffset, context, addressLocal);
        return { nextDecodeReader: advanceDecodeReader(afterSibOffset, 1, context), scratchLocals: [] };
      case 2:
        addSibBaseToAddress(context, sibLocal, addressLocal);
        addDisplacementToAddress(32, afterSibOffset, context, addressLocal);
        return { nextDecodeReader: advanceDecodeReader(afterSibOffset, 4, context), scratchLocals: [] };
      default:
        throw new Error(`unsupported SIB ModRM mod field: ${mod}`);
    }
  } finally {
    context.scratch.freeLocal(sibLocal);
  }
}

function decodeSibNoDisplacementBase(
  decodeReader: DecodeReader,
  context: InterpreterHandlerContext,
  sibLocal: number,
  addressLocal: number
): Readonly<{ nextDecodeReader: DecodeReader; scratchLocals: readonly number[] }> {
  const baseLocal = context.scratch.allocLocal(wasmValueType.i32);
  const nextDecodeReaderLocal = materializeDecodeReader(decodeReader, context);

  context.body.localGet(sibLocal).i32Const(0b111).i32And().localSet(baseLocal);

  try {
    emitIfLocalNotEqualsConst(context, baseLocal, 0b101, () => {
      addRegIndexLocalToAddress(context, baseLocal, addressLocal);
    });
    emitIfLocalEqualsConst(context, baseLocal, 0b101, () => {
      addDisplacementToAddress(32, decodeReader, context, addressLocal);
      advanceDecodeReader(localDecodeReader(nextDecodeReaderLocal), 4, context);
    });
  } finally {
    context.scratch.freeLocal(baseLocal);
  }

  return { nextDecodeReader: localDecodeReader(nextDecodeReaderLocal), scratchLocals: [nextDecodeReaderLocal] };
}

function addSibIndexToAddress(context: InterpreterHandlerContext, sibLocal: number, addressLocal: number): void {
  const indexLocal = context.scratch.allocLocal(wasmValueType.i32);

  context.body.localGet(sibLocal).i32Const(3).i32ShrU().i32Const(0b111).i32And().localSet(indexLocal);

  try {
    emitIfLocalNotEqualsConst(context, indexLocal, 0b100, () => {
      context.body.localGet(addressLocal);
      emitLoadReg32FromIndexLocal(context.body, indexLocal);
      context.body.localGet(sibLocal).i32Const(6).i32ShrU().i32Shl();
      context.body.i32Add().localSet(addressLocal);
    });
  } finally {
    context.scratch.freeLocal(indexLocal);
  }
}

function addSibBaseToAddress(context: InterpreterHandlerContext, sibLocal: number, addressLocal: number): void {
  const baseLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    context.body.localGet(sibLocal).i32Const(0b111).i32And().localSet(baseLocal);
    addRegIndexLocalToAddress(context, baseLocal, addressLocal);
  } finally {
    context.scratch.freeLocal(baseLocal);
  }
}

function addRegIndexLocalToAddress(context: InterpreterHandlerContext, indexLocal: number, addressLocal: number): void {
  context.body.localGet(addressLocal);
  emitLoadReg32FromIndexLocal(context.body, indexLocal);
  context.body.i32Add().localSet(addressLocal);
}

function loadDisplacementIntoAddress(
  width: 8 | 32,
  decodeReader: DecodeReader,
  context: InterpreterHandlerContext,
  addressLocal: number
): void {
  emitLoadDisplacement(width, decodeReader, context, addressLocal);
}

function addDisplacementToAddress(
  width: 8 | 32,
  decodeReader: DecodeReader,
  context: InterpreterHandlerContext,
  addressLocal: number
): void {
  const displacementLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitLoadDisplacement(width, decodeReader, context, displacementLocal);
    context.body.localGet(addressLocal).localGet(displacementLocal).i32Add().localSet(addressLocal);
  } finally {
    context.scratch.freeLocal(displacementLocal);
  }
}

function emitLoadDisplacement(
  width: 8 | 32,
  decodeReader: DecodeReader,
  context: InterpreterHandlerContext,
  local: number
): void {
  switch (width) {
    case 8:
      emitReadGuestByte(context, decodeReader, local);
      emitSignExtendLocal(context, local, 8);
      return;
    case 32:
      emitReadGuestU32(context, decodeReader, local);
      return;
  }
}

function emitIfLocalEqualsConst(
  context: InterpreterHandlerContext,
  local: number,
  value: number,
  emitThen: () => void
): void {
  context.body.localGet(local).i32Const(value).i32Xor().i32Eqz().ifBlock();
  emitThen();
  context.body.endBlock();
}

function emitIfLocalNotEqualsConst(
  context: InterpreterHandlerContext,
  local: number,
  value: number,
  emitThen: () => void
): void {
  context.body.localGet(local).i32Const(value).i32Xor().ifBlock();
  emitThen();
  context.body.endBlock();
}

function reg32FromIndex(index: number): (typeof reg32)[number] {
  const reg = reg32[index & 0b111];

  if (reg === undefined) {
    throw new Error(`register index out of range: ${index}`);
  }

  return reg;
}

function emitSignExtendLocal(context: InterpreterHandlerContext, local: number, width: 8 | 16 | 32): void {
  if (width === 32) {
    return;
  }

  const signBit = width === 8 ? 0x80 : 0x8000;

  context.body.localGet(local).i32Const(signBit).i32Xor().i32Const(signBit).i32Sub().localSet(local);
}
