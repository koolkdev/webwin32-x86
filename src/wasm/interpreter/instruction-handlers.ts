import { buildSir } from "../../arch/x86/sir/builder.js";
import type { ExpandedInstructionSpec, OperandSpec } from "../../arch/x86/isa/schema/types.js";
import type { OpcodeDispatchLeaf } from "../../arch/x86/isa/decoder/opcode-dispatch.js";
import type { SemanticTemplate } from "../../arch/x86/sir/types.js";
import type { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import { lowerSirWithInterpreterContext, type InterpreterOperandBinding } from "../sir/interpreter-context.js";
import { emitLoadGuestU32ForDecode } from "./guest-bytes.js";

export type InterpreterHandlerContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  eipLocal: number;
  addressLocal: number;
  opcodeLocal: number;
}>;

export function emitInstructionHandlerForLeaf(
  leaf: OpcodeDispatchLeaf,
  context: InterpreterHandlerContext
): boolean {
  const instruction = leaf.noModRmCandidates.find((candidate) => candidate.spec.id === "mov.r32_imm32");

  if (instruction === undefined) {
    return false;
  }

  emitNoModRmInstructionHandler(instruction, context);
  return true;
}

function emitNoModRmInstructionHandler(
  instruction: ExpandedInstructionSpec<SemanticTemplate>,
  context: InterpreterHandlerContext
): void {
  const decoded = decodeNoModRmOperands(instruction, context);
  const program = buildSir(instruction.spec.semantics);

  try {
    lowerSirWithInterpreterContext(program, {
      body: context.body,
      scratch: context.scratch,
      eipLocal: context.eipLocal,
      instructionLength: decoded.instructionLength,
      operands: decoded.operands
    });
  } finally {
    for (const local of decoded.scratchLocals) {
      context.scratch.freeLocal(local);
    }
  }
}

function decodeNoModRmOperands(
  instruction: ExpandedInstructionSpec<SemanticTemplate>,
  context: InterpreterHandlerContext
): Readonly<{
  instructionLength: number;
  operands: readonly InterpreterOperandBinding[];
  scratchLocals: readonly number[];
}> {
  const operands: InterpreterOperandBinding[] = [];
  const scratchLocals: number[] = [];
  let cursor = instruction.opcode.length;

  for (const operand of instruction.spec.operands ?? []) {
    const decoded = decodeOperand(operand, cursor, context);

    operands.push(decoded.binding);
    if (decoded.scratchLocal !== undefined) {
      scratchLocals.push(decoded.scratchLocal);
    }
    cursor = decoded.nextCursor;
  }

  return {
    instructionLength: cursor,
    operands,
    scratchLocals
  };
}

function decodeOperand(
  operand: OperandSpec,
  cursor: number,
  context: InterpreterHandlerContext
): Readonly<{ binding: InterpreterOperandBinding; nextCursor: number; scratchLocal?: number }> {
  switch (operand.kind) {
    case "opcode.reg":
      return {
        binding: { kind: "opcode.reg32", opcodeLocal: context.opcodeLocal },
        nextCursor: cursor
      };
    case "imm": {
      if (operand.width !== 32) {
        throw new Error(`unsupported immediate width for Wasm interpreter: ${operand.width}`);
      }

      const local = context.scratch.allocLocal(wasmValueType.i32);

      emitLoadGuestU32ForDecode(context.body, context.eipLocal, cursor, context.addressLocal, local);
      return {
        binding: { kind: "imm32", local },
        nextCursor: cursor + 4,
        scratchLocal: local
      };
    }
    default:
      throw new Error(`unsupported operand decode for Wasm interpreter: ${operand.kind}`);
  }
}
