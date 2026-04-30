import { buildSir } from "../../arch/x86/sir/builder.js";
import type { ExpandedInstructionSpec, ModRmMatch, OperandSpec } from "../../arch/x86/isa/schema/types.js";
import type { OpcodeDispatchLeaf } from "../../arch/x86/isa/decoder/opcode-dispatch.js";
import type { SemanticTemplate } from "../../arch/x86/sir/types.js";
import { JCC_DESCRIPTORS } from "../../arch/x86/isa/defs/control.js";
import type { WasmLocalScratchAllocator } from "../codegen/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import { lowerSirWithInterpreterContext, type InterpreterOperandBinding } from "../sir/interpreter-context.js";
import { emitLoadGuestByte, emitLoadGuestU32ForDecode } from "./guest-bytes.js";
import { emitRegisterModRmDispatch, type RegisterModRmDispatchCase } from "./modrm-dispatch.js";

const supportedNoModRmIds = new Set([
  "mov.r32_imm32",
  "add.eax_imm32",
  "sub.eax_imm32",
  "xor.eax_imm32",
  "cmp.eax_imm32",
  "test.eax_imm32",
  "jmp.rel8",
  "jmp.rel32",
  ...JCC_DESCRIPTORS.flatMap((descriptor) => [
    `${descriptor.mnemonicName}.rel8`,
    `${descriptor.mnemonicName}.rel32`
  ])
]);
const supportedModRmIds = new Set([
  "mov.r32_rm32",
  "mov.rm32_r32",
  "add.rm32_r32",
  "add.r32_rm32",
  "add.rm32_imm32",
  "add.rm32_imm8",
  "sub.rm32_r32",
  "sub.r32_rm32",
  "sub.rm32_imm32",
  "sub.rm32_imm8",
  "xor.rm32_r32",
  "xor.r32_rm32",
  "xor.rm32_imm32",
  "xor.rm32_imm8",
  "cmp.rm32_r32",
  "cmp.r32_rm32",
  "cmp.rm32_imm32",
  "cmp.rm32_imm8",
  "test.rm32_r32",
  "test.rm32_imm32"
]);

export type InterpreterHandlerContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  eipLocal: number;
  addressLocal: number;
  opcodeLocal: number;
  instructionDoneLabelDepth: number;
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

  const modRmCases = registerModRmDispatchCases(leaf);

  if (modRmCases.length === 0) {
    return false;
  }

  const modRmLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitLoadGuestByte(context.body, context.eipLocal, leaf.opcodeLength, context.addressLocal, modRmLocal);
    emitRegisterModRmDispatch(
      context.body,
      modRmLocal,
      context.opcodeLocal,
      bindModRmCases(modRmCases, context, modRmLocal)
    );
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
      operands: decoded.operands,
      instructionDoneLabelDepth: context.instructionDoneLabelDepth
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
    case "implicit.reg":
      return {
        binding: { kind: "implicit.reg32", reg: operand.reg },
        nextCursor: cursor
      };
    case "imm": {
      const local = context.scratch.allocLocal(wasmValueType.i32);

      emitLoadImmediateForDecode(operand, cursor, context, local);
      return {
        binding: { kind: "imm32", local },
        nextCursor: cursor + immediateByteLength(operand.width),
        scratchLocal: local
      };
    }
    case "rel": {
      const local = context.scratch.allocLocal(wasmValueType.i32);

      emitLoadRelativeTargetForDecode(operand, cursor, context, local);
      return {
        binding: { kind: "relTarget32", local },
        nextCursor: cursor + immediateByteLength(operand.width),
        scratchLocal: local
      };
    }
  }
}

type RegisterModRmCaseSpec = Readonly<{
  instruction: ExpandedInstructionSpec<SemanticTemplate>;
  bytes: number[];
}>;

function registerModRmDispatchCases(leaf: OpcodeDispatchLeaf): readonly RegisterModRmCaseSpec[] {
  const casesByInstruction = new Map<string, RegisterModRmCaseSpec>();

  for (let byte = 0xc0; byte <= 0xff; byte += 1) {
    const instruction = supportedRegisterModRmInstruction(leaf, byte);

    if (instruction === undefined) {
      continue;
    }

    let dispatchCase = casesByInstruction.get(instruction.spec.id);

    if (dispatchCase === undefined) {
      dispatchCase = { instruction, bytes: [] };
      casesByInstruction.set(instruction.spec.id, dispatchCase);
    }

    dispatchCase.bytes.push(byte);
  }

  return [...casesByInstruction.values()];
}

function bindModRmCases(
  cases: readonly RegisterModRmCaseSpec[],
  context: InterpreterHandlerContext,
  modRmLocal: number
): readonly RegisterModRmDispatchCase[] {
  return cases.map((dispatchCase, index) => ({
    bytes: dispatchCase.bytes,
    emit: () => {
      emitInstructionHandler(
        dispatchCase.instruction,
        { ...context, instructionDoneLabelDepth: context.instructionDoneLabelDepth + 1 + index },
        modRmLocal
      );
    }
  }));
}

function supportedRegisterModRmInstruction(
  leaf: OpcodeDispatchLeaf,
  modRmByte: number
): ExpandedInstructionSpec<SemanticTemplate> | undefined {
  const reg = (modRmByte >>> 3) & 0b111;
  const bucket = leaf.modRmByReg[reg] ?? [];

  return bucket.find(
    (candidate) => supportedModRmIds.has(candidate.spec.id) && modRmByteMatches(candidate.spec.modrm?.match, modRmByte)
  );
}

function modRmByteMatches(match: ModRmMatch | undefined, byte: number): boolean {
  if (match === undefined) {
    return true;
  }

  return (
    (match.mod === undefined || match.mod === ((byte >>> 6) & 0b11)) &&
    (match.reg === undefined || match.reg === ((byte >>> 3) & 0b111)) &&
    (match.rm === undefined || match.rm === (byte & 0b111))
  );
}

function emitLoadImmediateForDecode(
  operand: Extract<OperandSpec, { kind: "imm" }>,
  cursor: number,
  context: InterpreterHandlerContext,
  local: number
): void {
  switch (operand.width) {
    case 8:
      emitLoadGuestByte(context.body, context.eipLocal, cursor, context.addressLocal, local);
      break;
    case 16:
      emitLoadGuestU16ForDecode(context, cursor, local);
      break;
    case 32:
      emitLoadGuestU32ForDecode(context.body, context.eipLocal, cursor, context.addressLocal, local);
      break;
  }

  if (operand.extension === "sign") {
    emitSignExtendLocal(context.body, local, operand.width);
  }
}

function emitLoadRelativeTargetForDecode(
  operand: Extract<OperandSpec, { kind: "rel" }>,
  cursor: number,
  context: InterpreterHandlerContext,
  local: number
): void {
  switch (operand.width) {
    case 8:
      emitLoadGuestByte(context.body, context.eipLocal, cursor, context.addressLocal, local);
      emitSignExtendLocal(context.body, local, 8);
      break;
    case 32:
      emitLoadGuestU32ForDecode(context.body, context.eipLocal, cursor, context.addressLocal, local);
      break;
  }

  emitResolveRelativeTarget(context, local, cursor + immediateByteLength(operand.width));
}

function emitResolveRelativeTarget(
  context: InterpreterHandlerContext,
  displacementLocal: number,
  nextEipOffset: number
): void {
  emitNextEipForOffset(context, nextEipOffset);
  context.body.localGet(displacementLocal).i32Add().localSet(displacementLocal);
}

function emitNextEipForOffset(context: InterpreterHandlerContext, nextEipOffset: number): void {
  context.body.localGet(context.eipLocal).i32Const(nextEipOffset).i32Add();
}

function emitLoadGuestU16ForDecode(context: InterpreterHandlerContext, cursor: number, local: number): void {
  const highLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitLoadGuestByte(context.body, context.eipLocal, cursor, context.addressLocal, local);
    emitLoadGuestByte(context.body, context.eipLocal, cursor + 1, context.addressLocal, highLocal);
    context.body.localGet(local).localGet(highLocal).i32Const(8).i32Shl().i32Or().localSet(local);
  } finally {
    context.scratch.freeLocal(highLocal);
  }
}

function emitSignExtendLocal(body: WasmFunctionBodyEncoder, local: number, width: 8 | 16 | 32): void {
  if (width === 32) {
    return;
  }

  const signBit = width === 8 ? 0x80 : 0x8000;

  body.localGet(local).i32Const(signBit).i32Xor().i32Const(signBit).i32Sub().localSet(local);
}

function immediateByteLength(width: 8 | 16 | 32): number {
  return width / 8;
}
