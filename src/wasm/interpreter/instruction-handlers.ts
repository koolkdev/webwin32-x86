import { buildSir } from "../../arch/x86/sir/builder.js";
import type { ExpandedInstructionSpec, ModRmMatch, OperandSpec } from "../../arch/x86/isa/schema/types.js";
import type { OpcodeDispatchLeaf } from "../../arch/x86/isa/decoder/opcode-dispatch.js";
import type { SemanticTemplate } from "../../arch/x86/sir/types.js";
import { JCC_DESCRIPTORS } from "../../arch/x86/isa/defs/control.js";
import { wasmValueType } from "../encoder/types.js";
import { lowerSirWithInterpreterContext } from "../sir/interpreter-context.js";
import { emitLoadGuestByte } from "./guest-bytes.js";
import type { InterpreterHandlerContext } from "./handler-context.js";
import { emitModRmDispatch, type ModRmDispatchCase } from "./modrm-dispatch.js";
import { decodeInstructionOperands } from "./operand-decode.js";

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
  "test.rm32_imm32",
  "lea.r32_m32"
]);

export function emitInstructionHandlerForLeaf(
  leaf: OpcodeDispatchLeaf,
  context: InterpreterHandlerContext
): boolean {
  const noModRmInstruction = leaf.noModRmCandidates.find((candidate) => supportedNoModRmIds.has(candidate.spec.id));

  if (noModRmInstruction !== undefined) {
    emitInstructionHandler(noModRmInstruction, context, undefined, undefined);
    return true;
  }

  const modRmCases = registerModRmDispatchCases(leaf);

  if (modRmCases.length === 0) {
    return false;
  }

  const modRmLocal = context.scratch.allocLocal(wasmValueType.i32);

  try {
    emitLoadGuestByte(context.body, context.eipLocal, leaf.opcodeLength, context.addressLocal, modRmLocal);
    emitModRmDispatch(
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
  modRmLocal: number | undefined,
  modRmByte: number | undefined
): void {
  const decoded = decodeInstructionOperands(instruction, context, modRmLocal, modRmByte);
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

type RegisterModRmCaseSpec = Readonly<{
  instruction: ExpandedInstructionSpec<SemanticTemplate>;
  byte: number;
  bytes: readonly number[];
}>;

function registerModRmDispatchCases(leaf: OpcodeDispatchLeaf): readonly RegisterModRmCaseSpec[] {
  const cases: RegisterModRmCaseSpec[] = [];

  for (let byte = 0x00; byte <= 0xff; byte += 1) {
    const instruction = supportedRegisterModRmInstruction(leaf, byte);

    if (instruction === undefined) {
      continue;
    }

    cases.push({ instruction, byte, bytes: [byte] });
  }

  return cases;
}

function bindModRmCases(
  cases: readonly RegisterModRmCaseSpec[],
  context: InterpreterHandlerContext,
  modRmLocal: number
): readonly ModRmDispatchCase[] {
  return cases.map((dispatchCase, index) => ({
    bytes: dispatchCase.bytes,
    emit: () => {
      emitInstructionHandler(
        dispatchCase.instruction,
        { ...context, instructionDoneLabelDepth: context.instructionDoneLabelDepth + 1 + index },
        modRmLocal,
        dispatchCase.byte
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
    (candidate) =>
      supportedModRmIds.has(candidate.spec.id) &&
      modRmByteMatches(candidate.spec.modrm?.match, modRmByte) &&
      modRmOperandFormsMatch(candidate.spec.operands ?? [], modRmByte)
  );
}

function modRmOperandFormsMatch(operands: readonly OperandSpec[], byte: number): boolean {
  const mod = byte >>> 6;

  return operands.every((operand) => operand.kind !== "modrm.rm" || operand.type !== "m32" || mod !== 0b11);
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
