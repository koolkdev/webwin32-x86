import { buildSir } from "../../arch/x86/sir/builder.js";
import type { ExpandedInstructionSpec, ModRmMatch, OperandSpec } from "../../arch/x86/isa/schema/types.js";
import type { OpcodeDispatchLeaf } from "../../arch/x86/isa/decoder/opcode-dispatch.js";
import type { SemanticTemplate } from "../../arch/x86/sir/types.js";
import { wasmValueType } from "../encoder/types.js";
import { lowerSirWithInterpreterContext } from "../sir/interpreter-context.js";
import { emitLoadGuestByte } from "./guest-bytes.js";
import type { InterpreterHandlerContext } from "./handler-context.js";
import { emitModRmDispatch, type ModRmDispatchCase } from "./modrm-dispatch.js";
import { decodeInstructionOperands } from "./operand-decode.js";

export function emitInstructionHandlerForLeaf(
  leaf: OpcodeDispatchLeaf,
  context: InterpreterHandlerContext
): boolean {
  const noModRmInstruction = leaf.noModRmCandidates[0];

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
