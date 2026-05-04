import type { OperandSpec } from "#x86/isa/schema/types.js";
import type { InterpreterOperandBinding } from "#backends/wasm/interpreter/codegen/ir-context.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import { ExitReason } from "#backends/wasm/exit.js";
import { emitWasmIrExitFromI32Stack } from "#backends/wasm/codegen/exit.js";
import {
  advanceDecodeReader,
  emitReadGuestByte,
  emitReadGuestU32,
  localDecodeReader,
  materializeDecodeReader,
  type DecodeReader
} from "./decode-reader.js";
import type { InterpreterHandlerContext } from "#backends/wasm/interpreter/codegen/handler-context.js";
import { emitIfModRmMemory, emitIfModRmRegister } from "./modrm-bits.js";
import { emitCopyReg32FromIndexLocal } from "#backends/wasm/interpreter/dispatch/register-dispatch.js";

export function decodeModRmRmOperand(
  operand: Extract<OperandSpec, { kind: "modrm.rm" }>,
  decodeReader: DecodeReader,
  context: InterpreterHandlerContext,
  modRmLocal: number
): Readonly<{ binding: InterpreterOperandBinding; nextDecodeReader: DecodeReader; scratchLocals: readonly number[] }> {
  if (operand.type === "m32") {
    emitUnsupportedIfModRmRegister(context, modRmLocal);
  }

  const addressLocal = context.scratch.allocLocal(wasmValueType.i32);
  const decoded = decodeDynamicModRmRmAddress(decodeReader, context, modRmLocal, addressLocal, operand.type);

  return {
    binding: operand.type === "m32"
      ? { kind: "mem32", addressLocal }
      : { kind: "rm32", modRmLocal, addressLocal },
    nextDecodeReader: decoded.nextDecodeReader,
    scratchLocals: [addressLocal, ...decoded.scratchLocals]
  };
}

function decodeDynamicModRmRmAddress(
  decodeReader: DecodeReader,
  context: InterpreterHandlerContext,
  modRmLocal: number,
  addressLocal: number,
  operandType: "rm32" | "m32"
): Readonly<{ nextDecodeReader: DecodeReader; scratchLocals: readonly number[] }> {
  const nextDecodeReaderLocal = materializeDecodeReader(decodeReader, context);

  if (operandType === "rm32") {
    emitIfModRmMemory(context.body, modRmLocal, () => {
      decodeDynamicMemoryAddress(localDecodeReader(nextDecodeReaderLocal), context, modRmLocal, addressLocal);
    });
  } else {
    decodeDynamicMemoryAddress(localDecodeReader(nextDecodeReaderLocal), context, modRmLocal, addressLocal);
  }

  return {
    nextDecodeReader: localDecodeReader(nextDecodeReaderLocal),
    scratchLocals: [nextDecodeReaderLocal]
  };
}

function decodeDynamicMemoryAddress(
  decodeReader: DecodeReader,
  context: InterpreterHandlerContext,
  modRmLocal: number,
  addressLocal: number
): void {
  const modLocal = context.scratch.allocLocal(wasmValueType.i32);
  const rmLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    context.body.localGet(modRmLocal).i32Const(6).i32ShrU().localSet(modLocal);
    context.body.localGet(modRmLocal).i32Const(0b111).i32And().localSet(rmLocal);

    emitIfLocalEqualsConst(context, rmLocal, 0b100, () => {
      decodeDynamicSibMemoryAddress(modLocal, decodeReader, context, addressLocal);
    });
    emitIfLocalNotEqualsConst(context, rmLocal, 0b100, () => {
      decodeDynamicNonSibMemoryAddress(modLocal, rmLocal, decodeReader, context, addressLocal);
    });
  } finally {
    context.scratch.freeLocal(rmLocal);
    context.scratch.freeLocal(modLocal);
  }
}

function decodeDynamicNonSibMemoryAddress(
  modLocal: number,
  rmLocal: number,
  decodeReader: DecodeReader,
  context: InterpreterHandlerContext,
  addressLocal: number
): void {
  emitIfLocalEqualsConst(context, modLocal, 0, () => {
    emitIfLocalEqualsConst(context, rmLocal, 0b101, () => {
      loadDisplacementIntoAddress(32, decodeReader, context, addressLocal);
      advanceDecodeReader(decodeReader, 4, context);
    });
    emitIfLocalNotEqualsConst(context, rmLocal, 0b101, () => {
      emitCopyReg32FromIndexLocal(context.body, context.state.regs, rmLocal, addressLocal);
    });
  });
  emitIfLocalEqualsConst(context, modLocal, 1, () => {
    emitCopyReg32FromIndexLocal(context.body, context.state.regs, rmLocal, addressLocal);
    addDisplacementToAddress(8, decodeReader, context, addressLocal);
    advanceDecodeReader(decodeReader, 1, context);
  });
  emitIfLocalEqualsConst(context, modLocal, 2, () => {
    emitCopyReg32FromIndexLocal(context.body, context.state.regs, rmLocal, addressLocal);
    addDisplacementToAddress(32, decodeReader, context, addressLocal);
    advanceDecodeReader(decodeReader, 4, context);
  });
}

function decodeDynamicSibMemoryAddress(
  modLocal: number,
  decodeReader: DecodeReader,
  context: InterpreterHandlerContext,
  addressLocal: number
): void {
  const sibLocal = context.scratch.allocLocal(wasmValueType.i32);
  const baseLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitReadGuestByte(context, decodeReader, sibLocal);
    advanceDecodeReader(decodeReader, 1, context);
    context.body.i32Const(0).localSet(addressLocal);
    addSibIndexToAddress(context, sibLocal, addressLocal);
    context.body.localGet(sibLocal).i32Const(0b111).i32And().localSet(baseLocal);

    emitIfLocalEqualsConst(context, modLocal, 0, () => {
      emitIfLocalEqualsConst(context, baseLocal, 0b101, () => {
        addDisplacementToAddress(32, decodeReader, context, addressLocal);
        advanceDecodeReader(decodeReader, 4, context);
      });
      emitIfLocalNotEqualsConst(context, baseLocal, 0b101, () => {
        addRegIndexLocalToAddress(context, baseLocal, addressLocal);
      });
    });
    emitIfLocalEqualsConst(context, modLocal, 1, () => {
      addRegIndexLocalToAddress(context, baseLocal, addressLocal);
      addDisplacementToAddress(8, decodeReader, context, addressLocal);
      advanceDecodeReader(decodeReader, 1, context);
    });
    emitIfLocalEqualsConst(context, modLocal, 2, () => {
      addRegIndexLocalToAddress(context, baseLocal, addressLocal);
      addDisplacementToAddress(32, decodeReader, context, addressLocal);
      advanceDecodeReader(decodeReader, 4, context);
    });
  } finally {
    context.scratch.freeLocal(baseLocal);
    context.scratch.freeLocal(sibLocal);
  }
}

function addSibIndexToAddress(context: InterpreterHandlerContext, sibLocal: number, addressLocal: number): void {
  const indexLocal = context.scratch.allocLocal(wasmValueType.i32);
  const indexValueLocal = context.scratch.allocLocal(wasmValueType.i32);

  context.body.localGet(sibLocal).i32Const(3).i32ShrU().i32Const(0b111).i32And().localSet(indexLocal);

  try {
    emitIfLocalNotEqualsConst(context, indexLocal, 0b100, () => {
      context.body.localGet(addressLocal);
      emitCopyReg32FromIndexLocal(context.body, context.state.regs, indexLocal, indexValueLocal);
      context.body.localGet(indexValueLocal);
      context.body.localGet(sibLocal).i32Const(6).i32ShrU().i32Shl();
      context.body.i32Add().localSet(addressLocal);
    });
  } finally {
    context.scratch.freeLocal(indexValueLocal);
    context.scratch.freeLocal(indexLocal);
  }
}

function addRegIndexLocalToAddress(context: InterpreterHandlerContext, indexLocal: number, addressLocal: number): void {
  const valueLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    context.body.localGet(addressLocal);
    emitCopyReg32FromIndexLocal(context.body, context.state.regs, indexLocal, valueLocal);
    context.body.localGet(valueLocal);
    context.body.i32Add().localSet(addressLocal);
  } finally {
    context.scratch.freeLocal(valueLocal);
  }
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

function emitUnsupportedIfModRmRegister(context: InterpreterHandlerContext, modRmLocal: number): void {
  emitIfModRmRegister(context.body, modRmLocal, () => {
    context.body.localGet(context.opcodeLocal);
    emitWasmIrExitFromI32Stack(context.body, context.exit, ExitReason.UNSUPPORTED, 1);
  });
}

function emitSignExtendLocal(context: InterpreterHandlerContext, local: number, width: 8 | 16 | 32): void {
  if (width === 32) {
    return;
  }

  const signBit = width === 8 ? 0x80 : 0x8000;

  context.body.localGet(local).i32Const(signBit).i32Xor().i32Const(signBit).i32Sub().localSet(local);
}
