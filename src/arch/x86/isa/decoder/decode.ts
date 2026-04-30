import type { SemanticTemplate } from "../../sir/types.js";
import { u32 } from "../../../../core/state/cpu-state.js";
import { X86_32_CORE } from "../index.js";
import {
  expandInstructionSpec,
  instructionReadsModRm
} from "../schema/builders.js";
import type { ExpandedInstructionSpec, ModRmMatch, OperandSpec, Reg3 } from "../schema/types.js";
import { reg32, type Reg32 } from "../types.js";
import { signedImm8, signedImm32 } from "./immediate.js";
import { decodeRm32ModRm, rm32ModRmByteLengthAt } from "./modrm.js";
import { buildOpcodeDispatch, opcodeLeaf, type OpcodeDispatchLeaf } from "./opcode-dispatch.js";
import { ByteArrayDecodeReader, readRawBytes, readU16LE, readU32LE, type IsaDecodeReader } from "./reader.js";
import type { IsaDecodedInstruction, IsaDecodeResult, IsaOperandBinding } from "./types.js";

type DecodedModRm = Readonly<{
  mod: Reg3;
  regField: Reg3;
  rmField: Reg3;
  reg: Reg32;
  rm: IsaOperandBinding;
  byteLength: number;
}>;

type CandidateDecode =
  | Readonly<{ kind: "match"; instruction: IsaDecodedInstruction }>
  | Readonly<{ kind: "skip" }>
  | Readonly<{ kind: "unsupported"; length: number }>;

type DispatchedCandidates = Readonly<{
  candidates: readonly ExpandedInstructionSpec<SemanticTemplate>[];
  modrm: DecodedModRm | undefined;
  unsupportedLength: number;
}>;

const EXPANDED_INSTRUCTIONS: readonly ExpandedInstructionSpec<SemanticTemplate>[] =
  X86_32_CORE.instructions.flatMap((spec) => expandInstructionSpec(spec));
const OPCODE_DISPATCH_ROOT = buildOpcodeDispatch(EXPANDED_INSTRUCTIONS);

export function decodeIsaInstruction(
  bytes: Uint8Array<ArrayBufferLike>,
  offset: number,
  address: number
): IsaDecodeResult {
  return decodeIsaInstructionFromReader(new ByteArrayDecodeReader(bytes, address, offset), address);
}

export function decodeIsaInstructionFromReader(
  reader: IsaDecodeReader,
  address: number
): IsaDecodeResult {
  const lookup = opcodeLeaf(OPCODE_DISPATCH_ROOT, reader, address);

  if (lookup.kind === "unsupported") {
    return unsupported(reader, address, lookup.length);
  }

  const dispatched = dispatchCandidates(reader, address, lookup.leaf);

  for (const expanded of dispatched.candidates) {
    const decoded = decodeCandidate(reader, address, expanded, dispatched.modrm);

    if (decoded.kind === "match") {
      return { kind: "ok", instruction: decoded.instruction };
    }

    if (decoded.kind === "unsupported") {
      return unsupported(reader, address, decoded.length);
    }
  }

  return unsupported(reader, address, dispatched.unsupportedLength);
}

function decodeCandidate(
  reader: IsaDecodeReader,
  address: number,
  expanded: ExpandedInstructionSpec<SemanticTemplate>,
  dispatchedModRm: DecodedModRm | undefined
): CandidateDecode {
  const spec = expanded.spec;
  let cursor = address + expanded.opcode.length;
  const modrm = instructionReadsModRm(spec) ? dispatchedModRm ?? decodeModRm(reader, cursor) : undefined;

  if (modrm !== undefined) {
    if (!modRmMatches(spec.modrm?.match, modrm)) {
      return { kind: "skip" };
    }

    cursor += modrm.byteLength;
  }

  const operands: IsaOperandBinding[] = [];

  for (const operand of spec.operands ?? []) {
    const decoded = decodeOperand(reader, cursor, expanded, modrm, operand);

    if (decoded.kind === "unsupported") {
      return { kind: "unsupported", length: cursor - address };
    }

    operands.push(decoded.binding);
    cursor = decoded.cursor;
  }

  const length = cursor - address;

  return {
    kind: "match",
    instruction: {
      spec,
      address,
      length,
      nextEip: u32(address + length),
      operands,
      raw: readRawBytes(reader, address, cursor)
    }
  };
}

function decodeOperand(
  reader: IsaDecodeReader,
  cursor: number,
  expanded: ExpandedInstructionSpec<SemanticTemplate>,
  modrm: DecodedModRm | undefined,
  operand: OperandSpec
):
  | Readonly<{ kind: "ok"; binding: IsaOperandBinding; cursor: number }>
  | Readonly<{ kind: "unsupported" }> {
  switch (operand.kind) {
    case "modrm.reg":
      return modrm === undefined ? { kind: "unsupported" } : { kind: "ok", binding: { kind: "reg32", reg: modrm.reg }, cursor };
    case "modrm.rm":
      if (modrm === undefined || (operand.type === "m32" && modrm.rm.kind !== "mem32")) {
        return { kind: "unsupported" };
      }

      return { kind: "ok", binding: modrm.rm, cursor };
    case "opcode.reg":
      return expanded.opcodeLowBits === undefined
        ? { kind: "unsupported" }
        : { kind: "ok", binding: registerBinding(expanded.opcodeLowBits), cursor };
    case "implicit.reg":
      return { kind: "ok", binding: { kind: "reg32", reg: operand.reg }, cursor };
    case "imm": {
      const immediate = readImmediate(reader, cursor, operand.width, operand.extension);

      return {
        kind: "ok",
        binding: immediate.extension === undefined
          ? { kind: "imm32", value: immediate.value, encodedWidth: operand.width }
          : { kind: "imm32", value: immediate.value, encodedWidth: operand.width, extension: immediate.extension },
        cursor: cursor + immediate.byteLength
      };
    }
    case "rel": {
      const relative = readRelative(reader, cursor, operand.width);
      const nextEip = u32(cursor + relative.byteLength);

      return {
        kind: "ok",
        binding: {
          kind: "relTarget",
          width: operand.width,
          displacement: relative.displacement,
          target: u32(nextEip + relative.displacement)
        },
        cursor: cursor + relative.byteLength
      };
    }
  }
}

function decodeModRm(reader: IsaDecodeReader, address: number): DecodedModRm {
  const value = reader.readU8(address);
  const decoded = decodeRm32ModRm(reader, address);

  return {
    mod: reg3(value >>> 6),
    regField: reg3(value >>> 3),
    rmField: reg3(value),
    reg: decoded.reg,
    rm: decoded.rm,
    byteLength: rm32ModRmByteLengthAt(reader, address)
  };
}

function modRmMatches(match: ModRmMatch | undefined, modrm: DecodedModRm): boolean {
  return (
    reg3Matches(match?.mod, modrm.mod) &&
    reg3Matches(match?.reg, modrm.regField) &&
    reg3Matches(match?.rm, modrm.rmField)
  );
}

function reg3Matches(expected: Reg3 | undefined, actual: Reg3): boolean {
  return expected === undefined || expected === actual;
}

function readImmediate(
  reader: IsaDecodeReader,
  address: number,
  width: 8 | 16 | 32,
  extension: "sign" | "zero" | undefined
): Readonly<{ value: number; byteLength: number; extension?: "sign" | "zero" }> {
  switch (width) {
    case 8: {
      const value = reader.readU8(address);
      const extended = extension === "sign" ? u32(signedImm8(value)) : value;

      return extension === undefined
        ? { value: extended, byteLength: 1 }
        : { value: extended, byteLength: 1, extension };
    }
    case 16: {
      const value = readU16LE(reader, address);
      const extended = extension === "sign" && (value & 0x8000) !== 0 ? u32(value - 0x1_0000) : value;

      return extension === undefined
        ? { value: extended, byteLength: 2 }
        : { value: extended, byteLength: 2, extension };
    }
    case 32:
      return { value: readU32LE(reader, address), byteLength: 4 };
  }
}

function readRelative(
  reader: IsaDecodeReader,
  address: number,
  width: 8 | 32
): Readonly<{ displacement: number; byteLength: number }> {
  return width === 8
    ? { displacement: signedImm8(reader.readU8(address)), byteLength: 1 }
    : { displacement: signedImm32(readU32LE(reader, address)), byteLength: 4 };
}

function registerBinding(index: number): IsaOperandBinding {
  const reg = reg32[index];

  if (reg === undefined) {
    throw new Error(`opcode register index out of range: ${index}`);
  }

  return { kind: "reg32", reg };
}

function unsupported(reader: IsaDecodeReader, address: number, length: number): IsaDecodeResult {
  const raw = readRawBytes(reader, address, address + length);
  const unsupportedByte = raw[0];
  const result = {
    kind: "unsupported" as const,
    address,
    length,
    raw
  };

  return unsupportedByte === undefined ? result : { ...result, unsupportedByte };
}

function reg3(value: number): Reg3 {
  return (value & 0b111) as Reg3;
}

function dispatchCandidates(reader: IsaDecodeReader, address: number, leaf: OpcodeDispatchLeaf): DispatchedCandidates {
  if (leaf.noModRmCandidates.length > 0) {
    return {
      candidates: leaf.noModRmCandidates,
      modrm: undefined,
      unsupportedLength: leaf.opcodeLength
    };
  }

  const modrm = decodeModRm(reader, address + leaf.opcodeLength);

  return {
    candidates: leaf.modRmByReg[modrm.regField] ?? [],
    modrm,
    unsupportedLength: leaf.opcodeLength + modrm.byteLength
  };
}
