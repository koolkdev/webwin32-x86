import { buildIr } from "../../../../x86/ir/builder.js";
import type { ExpandedInstructionSpec, ModRmMatch, Reg3 } from "../../../../x86/isa/schema/types.js";
import type { OpcodeDispatchLeaf } from "../../../../x86/isa/decoder/opcode-dispatch.js";
import type { SemanticTemplate } from "../../../../x86/ir/types.js";
import { wasmValueType } from "../../encoder/types.js";
import { lowerIrWithInterpreterContext } from "../lowering/ir-context.js";
import { emitLoadGuestByte } from "../decode/guest-bytes.js";
import type { InterpreterHandlerContext } from "../lowering/handler-context.js";
import { emitModRmDispatch, type ModRmDispatchCase } from "./modrm-dispatch.js";
import { decodeInstructionOperands } from "../decode/operand-decode.js";

export function emitInstructionHandlerForLeaf(
  leaf: OpcodeDispatchLeaf,
  context: InterpreterHandlerContext
): boolean {
  const noModRmInstruction = leaf.noModRmCandidates[0];

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
    emitLoadGuestByte(context.body, context.eipLocal, leaf.opcodeLength, context.addressLocal, modRmLocal, context.exit);

    if (modRmCases.length === 1 && modRmCases[0]?.regs.length === reg3Values.length) {
      emitInstructionHandler(modRmCases[0].instruction, context, modRmLocal);
      return true;
    }

    emitModRmDispatch(
      context.body,
      context.exit,
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
  const decoded = decodeInstructionOperands(instruction, context, modRmLocal);
  const program = buildIr(instruction.spec.semantics);

  try {
    lowerIrWithInterpreterContext(program, {
      body: context.body,
      scratch: context.scratch,
      state: context.state,
      exit: context.exit,
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

type ModRmCaseSpec = Readonly<{
  instruction: ExpandedInstructionSpec<SemanticTemplate>;
  regs: readonly Reg3[];
}>;

function registerModRmDispatchCases(leaf: OpcodeDispatchLeaf): readonly ModRmCaseSpec[] {
  const casesByInstruction = new Map<string, { instruction: ExpandedInstructionSpec<SemanticTemplate>; regs: Reg3[] }>();

  for (const reg of reg3Values) {
    const instruction = supportedRegisterModRmInstruction(leaf, reg);

    if (instruction === undefined) {
      continue;
    }

    const existing = casesByInstruction.get(instruction.spec.id);

    if (existing === undefined) {
      casesByInstruction.set(instruction.spec.id, { instruction, regs: [reg] });
    } else {
      existing.regs.push(reg);
    }
  }

  return [...casesByInstruction.values()];
}

function bindModRmCases(
  cases: readonly ModRmCaseSpec[],
  context: InterpreterHandlerContext,
  modRmLocal: number
): readonly ModRmDispatchCase[] {
  return cases.map((dispatchCase, index) => ({
    regs: dispatchCase.regs,
    emit: () => {
      emitInstructionHandler(
        dispatchCase.instruction,
        {
          ...context,
          instructionDoneLabelDepth: context.instructionDoneLabelDepth + 1 + index,
          exit: {
            ...context.exit,
            exitLabelDepth: context.exit.exitLabelDepth + 1 + index
          }
        },
        modRmLocal
      );
    }
  }));
}

function supportedRegisterModRmInstruction(
  leaf: OpcodeDispatchLeaf,
  reg: Reg3
): ExpandedInstructionSpec<SemanticTemplate> | undefined {
  const bucket = leaf.modRmByReg[reg] ?? [];

  return bucket.find((candidate) => modRmRegMatches(candidate.spec.modrm?.match, reg));
}

function modRmRegMatches(match: ModRmMatch | undefined, reg: Reg3): boolean {
  if (match === undefined) {
    return true;
  }

  if (match.mod !== undefined || match.rm !== undefined) {
    throw new Error("Wasm interpreter ModRM dispatch only supports instruction-selection matches on ModRM.reg");
  }

  return match.reg === undefined || match.reg === reg;
}

const reg3Values = [0, 1, 2, 3, 4, 5, 6, 7] as const satisfies readonly Reg3[];
