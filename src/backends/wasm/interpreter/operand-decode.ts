import type { ExpandedInstructionSpec, OperandSpec } from "../../../x86/isa/schema/types.js";
import type {
  InterpreterInstructionLength,
  InterpreterOperandBinding
} from "./ir-context.js";
import { wasmValueType } from "../encoder/types.js";
import { decodeModRmRmOperand } from "./address-decode.js";
import {
  advanceDecodeReader,
  emitReadGuestByte,
  emitReadGuestBytePlus,
  emitReadGuestU32,
  instructionLengthFromDecodeReader,
  staticDecodeReader,
  type DecodeReader
} from "./decode-reader.js";
import type { InterpreterHandlerContext } from "./handler-context.js";

export type DecodedInterpreterOperands = Readonly<{
  instructionLength: InterpreterInstructionLength;
  operands: readonly InterpreterOperandBinding[];
  scratchLocals: readonly number[];
}>;

export function decodeInstructionOperands(
  instruction: ExpandedInstructionSpec<unknown>,
  context: InterpreterHandlerContext,
  modRmLocal: number | undefined
): DecodedInterpreterOperands {
  const operands: InterpreterOperandBinding[] = [];
  const scratchLocals: number[] = [];
  let reader: DecodeReader = staticDecodeReader(instruction.opcode.length);

  if (modRmLocal !== undefined) {
    reader = advanceDecodeReader(reader, 1, context);
  }

  for (const operand of instruction.spec.operands ?? []) {
    const decoded = decodeOperand(operand, reader, context, modRmLocal);

    operands.push(decoded.binding);
    scratchLocals.push(...decoded.scratchLocals);
    reader = decoded.nextReader;
  }

  return {
    instructionLength: instructionLengthFromDecodeReader(reader),
    operands,
    scratchLocals
  };
}

function decodeOperand(
  operand: OperandSpec,
  reader: DecodeReader,
  context: InterpreterHandlerContext,
  modRmLocal: number | undefined
): Readonly<{ binding: InterpreterOperandBinding; nextReader: DecodeReader; scratchLocals: readonly number[] }> {
  switch (operand.kind) {
    case "modrm.reg":
      if (modRmLocal === undefined) {
        throw new Error("missing ModRM local for modrm.reg operand");
      }

      return {
        binding: { kind: "modrm.reg32", modRmLocal },
        nextReader: reader,
        scratchLocals: []
      };
    case "modrm.rm":
      if (modRmLocal === undefined) {
        throw new Error("missing ModRM local for modrm.rm operand");
      }

      return mapNextReader(decodeModRmRmOperand(operand, reader, context, modRmLocal));
    case "opcode.reg":
      return {
        binding: { kind: "opcode.reg32", opcodeLocal: context.opcodeLocal },
        nextReader: reader,
        scratchLocals: []
      };
    case "implicit.reg":
      return {
        binding: { kind: "implicit.reg32", reg: operand.reg },
        nextReader: reader,
        scratchLocals: []
      };
    case "imm": {
      const local = context.scratch.allocLocal(wasmValueType.i32);

      emitLoadImmediateForDecode(operand, reader, context, local);
      return {
        binding: { kind: "imm32", local },
        nextReader: advanceDecodeReader(reader, immediateByteLength(operand.width), context),
        scratchLocals: [local]
      };
    }
    case "rel": {
      const local = context.scratch.allocLocal(wasmValueType.i32);

      emitLoadRelativeTargetForDecode(operand, reader, context, local);
      return {
        binding: { kind: "relTarget32", local },
        nextReader: advanceDecodeReader(reader, immediateByteLength(operand.width), context),
        scratchLocals: [local]
      };
    }
  }
}

function mapNextReader(
  decoded: Readonly<{
    binding: InterpreterOperandBinding;
    nextDecodeReader: DecodeReader;
    scratchLocals: readonly number[];
  }>
): Readonly<{ binding: InterpreterOperandBinding; nextReader: DecodeReader; scratchLocals: readonly number[] }> {
  return {
    binding: decoded.binding,
    nextReader: decoded.nextDecodeReader,
    scratchLocals: decoded.scratchLocals
  };
}

function emitLoadImmediateForDecode(
  operand: Extract<OperandSpec, { kind: "imm" }>,
  reader: DecodeReader,
  context: InterpreterHandlerContext,
  local: number
): void {
  switch (operand.width) {
    case 8:
      emitReadGuestByte(context, reader, local);
      break;
    case 16:
      emitLoadGuestU16ForDecode(context, reader, local);
      break;
    case 32:
      emitReadGuestU32(context, reader, local);
      break;
  }

  if (operand.extension === "sign") {
    emitSignExtendLocal(context, local, operand.width);
  }
}

function emitLoadRelativeTargetForDecode(
  operand: Extract<OperandSpec, { kind: "rel" }>,
  reader: DecodeReader,
  context: InterpreterHandlerContext,
  local: number
): void {
  switch (operand.width) {
    case 8:
      emitReadGuestByte(context, reader, local);
      emitSignExtendLocal(context, local, 8);
      break;
    case 32:
      emitReadGuestU32(context, reader, local);
      break;
  }

  emitResolveRelativeTarget(context, local, reader, immediateByteLength(operand.width));
}

function emitResolveRelativeTarget(
  context: InterpreterHandlerContext,
  displacementLocal: number,
  displacementReader: DecodeReader,
  displacementByteLength: number
): void {
  emitNextEipForReader(context, displacementReader, displacementByteLength);
  context.body.localGet(displacementLocal).i32Add().localSet(displacementLocal);
}

function emitNextEipForReader(context: InterpreterHandlerContext, reader: DecodeReader, byteLength: number): void {
  context.body.localGet(context.eipLocal);

  if (reader.kind === "static") {
    context.body.i32Const(reader.value + byteLength);
  } else {
    context.body.localGet(reader.local).i32Const(byteLength).i32Add();
  }

  context.body.i32Add();
}

function emitLoadGuestU16ForDecode(
  context: InterpreterHandlerContext,
  reader: DecodeReader,
  local: number
): void {
  const highLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitReadGuestByte(context, reader, local);
    emitReadGuestBytePlus(context, reader, 1, highLocal);
    context.body.localGet(local).localGet(highLocal).i32Const(8).i32Shl().i32Or().localSet(local);
  } finally {
    context.scratch.freeLocal(highLocal);
  }
}

function emitSignExtendLocal(context: InterpreterHandlerContext, local: number, width: 8 | 16 | 32): void {
  if (width === 32) {
    return;
  }

  const signBit = width === 8 ? 0x80 : 0x8000;

  context.body.localGet(local).i32Const(signBit).i32Xor().i32Const(signBit).i32Sub().localSet(local);
}

function immediateByteLength(width: 8 | 16 | 32): number {
  return width / 8;
}
