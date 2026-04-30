import { buildSir } from "../../arch/x86/sir/builder.js";
import type { ExpandedInstructionSpec, OperandSpec } from "../../arch/x86/isa/schema/types.js";
import type { OpcodeDispatchLeaf } from "../../arch/x86/isa/decoder/opcode-dispatch.js";
import type { SemanticTemplate } from "../../arch/x86/sir/types.js";
import type { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import { lowerSirWithInterpreterContext, type InterpreterOperandBinding } from "../sir/interpreter-context.js";
import { emitLoadGuestByte, emitLoadGuestU32ForDecode } from "./guest-bytes.js";
import { emitRegisterModRmDispatch } from "./modrm-dispatch.js";

const supportedNoModRmIds = new Set(["mov.r32_imm32"]);
const supportedModRmIds = new Set([
  "mov.r32_rm32",
  "mov.rm32_r32",
  "add.rm32_r32",
  "add.r32_rm32",
  "sub.rm32_r32",
  "sub.r32_rm32",
  "xor.rm32_r32",
  "xor.r32_rm32",
  "cmp.rm32_r32",
  "cmp.r32_rm32",
  "test.rm32_r32"
]);

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
  const noModRmInstruction = leaf.noModRmCandidates.find((candidate) => supportedNoModRmIds.has(candidate.spec.id));

  if (noModRmInstruction !== undefined) {
    emitInstructionHandler(noModRmInstruction, context, undefined);
    return true;
  }

  const modRmInstruction = uniqueModRmCandidates(leaf).find((candidate) => supportedModRmIds.has(candidate.spec.id));

  if (modRmInstruction === undefined) {
    return false;
  }

  const modRmLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitLoadGuestByte(context.body, context.eipLocal, modRmInstruction.opcode.length, context.addressLocal, modRmLocal);
    emitRegisterModRmDispatch(context.body, modRmLocal, context.opcodeLocal, () => {
      emitInstructionHandler(modRmInstruction, context, modRmLocal);
    });
  } finally {
    context.scratch.freeLocal(modRmLocal);
  }

  return true;
}

function emitInstructionHandler(
  instruction: ExpandedInstructionSpec<SemanticTemplate>,
  context: InterpreterHandlerContext,
  modRmLocal: number | undefined
): void {
  const decoded = decodeOperands(instruction, context, modRmLocal);
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

function decodeOperands(
  instruction: ExpandedInstructionSpec<SemanticTemplate>,
  context: InterpreterHandlerContext,
  modRmLocal: number | undefined
): Readonly<{
  instructionLength: number;
  operands: readonly InterpreterOperandBinding[];
  scratchLocals: readonly number[];
}> {
  const operands: InterpreterOperandBinding[] = [];
  const scratchLocals: number[] = [];
  let cursor = instruction.opcode.length;

  if (modRmLocal !== undefined) {
    cursor += 1;
  }

  for (const operand of instruction.spec.operands ?? []) {
    const decoded = decodeOperand(operand, cursor, context, modRmLocal);

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
  context: InterpreterHandlerContext,
  modRmLocal: number | undefined
): Readonly<{ binding: InterpreterOperandBinding; nextCursor: number; scratchLocal?: number }> {
  switch (operand.kind) {
    case "modrm.reg":
      if (modRmLocal === undefined) {
        throw new Error("missing ModRM local for modrm.reg operand");
      }

      return {
        binding: { kind: "modrm.reg32", modRmLocal },
        nextCursor: cursor
      };
    case "modrm.rm":
      if (modRmLocal === undefined) {
        throw new Error("missing ModRM local for modrm.rm operand");
      }

      if (operand.type !== "rm32") {
        throw new Error(`unsupported ModRM r/m operand type for Wasm interpreter: ${operand.type}`);
      }

      return {
        binding: { kind: "modrm.rm32", modRmLocal },
        nextCursor: cursor
      };
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

function uniqueModRmCandidates(leaf: OpcodeDispatchLeaf): readonly ExpandedInstructionSpec<SemanticTemplate>[] {
  const seen = new Set<string>();
  const candidates: ExpandedInstructionSpec<SemanticTemplate>[] = [];

  for (const bucket of leaf.modRmByReg) {
    for (const candidate of bucket) {
      if (!seen.has(candidate.spec.id)) {
        seen.add(candidate.spec.id);
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}
