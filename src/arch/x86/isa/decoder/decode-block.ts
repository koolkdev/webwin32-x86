import { u32 } from "../../../../core/state/cpu-state.js";
import { buildSir } from "../../sir/builder.js";
import type { SirProgram } from "../../sir/types.js";
import { decodeIsaInstruction } from "./decode.js";
import type { IsaDecodedInstruction } from "./types.js";

export type IsaBlockDecodeReader = Readonly<{
  sliceFrom(eip: number, maxBytes: number): Uint8Array<ArrayBufferLike> | IsaDecodeFault;
}>;

export type IsaDecodeFault = Readonly<{
  address: number;
  raw: readonly number[];
}>;

export type IsaDecodedBlock = Readonly<{
  startEip: number;
  instructions: readonly IsaDecodedInstruction[];
  terminator: IsaBlockTerminator;
}>;

export type IsaBlockTerminator =
  | Readonly<{ kind: "fallthrough"; nextEip: number }>
  | Readonly<{ kind: "control"; instruction: IsaDecodedInstruction }>
  | Readonly<{
      kind: "unsupported";
      address: number;
      length: number;
      raw: readonly number[];
      unsupportedByte?: number;
    }>
  | Readonly<{ kind: "decode-fault"; fault: IsaDecodeFault }>;

export type DecodeIsaBlockOptions = Readonly<{
  maxInstructions?: number;
}>;

const defaultMaxInstructions = 64;
const maxInstructionLength = 15;

export function decodeIsaBlock(
  reader: IsaBlockDecodeReader,
  startEip: number,
  options: DecodeIsaBlockOptions = {}
): IsaDecodedBlock {
  const instructions: IsaDecodedInstruction[] = [];
  const maxInstructions = options.maxInstructions ?? defaultMaxInstructions;
  let eip = u32(startEip);

  for (let count = 0; count < maxInstructions; count += 1) {
    const bytes = reader.sliceFrom(eip, maxInstructionLength);

    if (!(bytes instanceof Uint8Array)) {
      return { startEip, instructions, terminator: { kind: "decode-fault", fault: bytes } };
    }

    const decoded = decodeInstruction(bytes, eip);

    if (decoded.kind === "decode-fault") {
      return { startEip, instructions, terminator: decoded };
    }

    if (decoded.kind === "unsupported") {
      return { startEip, instructions, terminator: decoded };
    }

    instructions.push(decoded.instruction);

    if (isBlockTerminator(decoded.instruction)) {
      return { startEip, instructions, terminator: { kind: "control", instruction: decoded.instruction } };
    }

    eip = decoded.instruction.nextEip;
  }

  return { startEip, instructions, terminator: { kind: "fallthrough", nextEip: eip } };
}

function decodeInstruction(
  bytes: Uint8Array<ArrayBufferLike>,
  eip: number
):
  | Readonly<{ kind: "instruction"; instruction: IsaDecodedInstruction }>
  | Extract<IsaBlockTerminator, { kind: "unsupported" | "decode-fault" }> {
  try {
    const decoded = decodeIsaInstruction(bytes, 0, eip);

    if (decoded.kind === "unsupported") {
      return {
        kind: "unsupported",
        address: decoded.address,
        length: decoded.length,
        raw: decoded.raw,
        ...(decoded.unsupportedByte === undefined ? {} : { unsupportedByte: decoded.unsupportedByte })
      };
    }

    return { kind: "instruction", instruction: decoded.instruction };
  } catch (error: unknown) {
    if (error instanceof RangeError) {
      return {
        kind: "decode-fault",
        fault: {
          address: eip,
          raw: Array.from(bytes)
        }
      };
    }

    throw error;
  }
}

function isBlockTerminator(instruction: IsaDecodedInstruction): boolean {
  return sirTerminator(buildSir(instruction.spec.semantics)) !== "next";
}

function sirTerminator(program: SirProgram): SirProgram[number]["op"] {
  const terminator = program[program.length - 1];

  if (terminator === undefined) {
    throw new Error("SIR program is empty");
  }

  return terminator.op;
}
