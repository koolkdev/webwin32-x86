import type { SemanticTemplate } from "../../ir/model/types.js";
import { instructionReadsModRm } from "../schema/builders.js";
import type { ExpandedInstructionSpec, Reg3 } from "../schema/types.js";
import type { IsaDecodeReader } from "./reader.js";

export type OpcodeDispatchLeaf = Readonly<{
  opcodeLength: number;
  noModRmCandidates: readonly ExpandedInstructionSpec<SemanticTemplate>[];
  modRmByReg: readonly (readonly ExpandedInstructionSpec<SemanticTemplate>[])[];
}>;

export type OpcodeDispatchNode = Readonly<{
  leaf: OpcodeDispatchLeaf | undefined;
  next: readonly (OpcodeDispatchNode | undefined)[];
}>;

export type OpcodeLookup =
  | Readonly<{ kind: "leaf"; leaf: OpcodeDispatchLeaf }>
  | Readonly<{ kind: "unsupported"; length: number }>;

type MutableOpcodeDispatchLeaf = {
  opcodeLength: number;
  noModRmCandidates: ExpandedInstructionSpec<SemanticTemplate>[];
  modRmByReg: ExpandedInstructionSpec<SemanticTemplate>[][];
};

type MutableOpcodeDispatchNode = {
  leaf: MutableOpcodeDispatchLeaf | undefined;
  next: (MutableOpcodeDispatchNode | undefined)[];
};

export function buildOpcodeDispatch(
  instructions: readonly ExpandedInstructionSpec<SemanticTemplate>[]
): OpcodeDispatchNode {
  const root = opcodeDispatchNode();

  for (const instruction of instructions) {
    let node = root;

    for (const byte of instruction.opcode) {
      node.next[byte] ??= opcodeDispatchNode();
      node = node.next[byte];
    }

    node.leaf ??= opcodeDispatchLeaf(instruction.opcode.length);
    addOpcodeCandidate(node.leaf, instruction);
  }

  return root;
}

export function opcodeLeaf(
  root: OpcodeDispatchNode,
  reader: IsaDecodeReader,
  eip: number
): OpcodeLookup {
  let node = root;

  for (let cursor = eip, length = 1; ; cursor += 1, length += 1) {
    const next = node.next[reader.readU8(cursor)];

    if (next === undefined) {
      return { kind: "unsupported", length };
    }

    if (next.leaf !== undefined) {
      return { kind: "leaf", leaf: next.leaf };
    }

    node = next;
  }
}

function opcodeDispatchNode(): MutableOpcodeDispatchNode {
  return {
    leaf: undefined,
    next: new Array<MutableOpcodeDispatchNode | undefined>(256)
  };
}

function opcodeDispatchLeaf(opcodeLength: number): MutableOpcodeDispatchLeaf {
  return {
    opcodeLength,
    noModRmCandidates: [],
    modRmByReg: Array.from({ length: 8 }, () => [])
  };
}

function addOpcodeCandidate(
  leaf: MutableOpcodeDispatchLeaf,
  instruction: ExpandedInstructionSpec<SemanticTemplate>
): void {
  if (!instructionReadsModRm(instruction.spec)) {
    leaf.noModRmCandidates.push(instruction);
    return;
  }

  const regMatch = instruction.spec.modrm?.match?.reg;

  if (regMatch === undefined) {
    for (const candidates of leaf.modRmByReg) {
      candidates.push(instruction);
    }

    return;
  }

  addModRmRegCandidate(leaf, regMatch, instruction);
}

function addModRmRegCandidate(
  leaf: MutableOpcodeDispatchLeaf,
  reg: Reg3,
  instruction: ExpandedInstructionSpec<SemanticTemplate>
): void {
  const candidates = leaf.modRmByReg[reg];

  if (candidates === undefined) {
    throw new Error(`ModRM.reg dispatch bucket out of range: ${reg}`);
  }

  candidates.push(instruction);
}
