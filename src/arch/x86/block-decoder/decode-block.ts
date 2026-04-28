import { DecodeError, type DecodeFault } from "../decoder/decode-error.js";
import { maxInstructionLength } from "../decoder/decode-bounds.js";
import { decodeOne } from "../decoder/decoder.js";
import { instructionEnd } from "../instruction/address.js";
import { intVector, relativeTarget } from "../instruction/operands.js";
import type { DecodedInstruction } from "../instruction/types.js";
import { u32 } from "../../../core/state/cpu-state.js";
import type { DecodeReader } from "./decode-reader.js";

export type DecodedBlock = Readonly<{
  startEip: number;
  instructions: readonly DecodedInstruction[];
  terminator: BlockTerminator;
}>;

export type BlockTerminator =
  | Readonly<{ kind: "fallthrough"; nextEip: number }>
  | Readonly<{ kind: "jump"; instruction: DecodedInstruction; targetEip: number }>
  | Readonly<{ kind: "conditional-branch"; instruction: DecodedInstruction; targetEip: number; fallthroughEip: number }>
  | Readonly<{ kind: "call"; instruction: DecodedInstruction; targetEip: number; returnEip: number }>
  | Readonly<{ kind: "ret"; instruction: DecodedInstruction }>
  | Readonly<{ kind: "int"; instruction: DecodedInstruction; vector: number }>
  | Readonly<{ kind: "unsupported"; eip: number; instruction: DecodedInstruction }>
  | Readonly<{ kind: "decode-fault"; fault: DecodeFault }>;

export type DecodeBlockOptions = Readonly<{
  maxInstructions?: number;
}>;

const defaultMaxInstructions = 64;
const maxDecodeBytes = maxInstructionLength + 1;

export function decodeBlock(
  decodeReader: DecodeReader,
  startEip: number,
  options: DecodeBlockOptions = {}
): DecodedBlock {
  const instructions: DecodedInstruction[] = [];
  const maxInstructions = options.maxInstructions ?? defaultMaxInstructions;
  let eip = u32(startEip);

  for (let count = 0; count < maxInstructions; count += 1) {
    const bytes = decodeReader.sliceFrom(eip, maxDecodeBytes);

    if (!(bytes instanceof Uint8Array)) {
      return { startEip, instructions, terminator: { kind: "decode-fault", fault: bytes } };
    }

    let instruction: DecodedInstruction;

    try {
      instruction = decodeOne(bytes, 0, eip);
    } catch (error: unknown) {
      if (error instanceof DecodeError) {
        return { startEip, instructions, terminator: { kind: "decode-fault", fault: error.fault } };
      }

      throw error;
    }

    instructions.push(instruction);

    const terminator = terminatorFor(instruction);

    if (terminator !== undefined) {
      return { startEip, instructions, terminator };
    }

    eip = instructionEnd(instruction);
  }

  return { startEip, instructions, terminator: { kind: "fallthrough", nextEip: eip } };
}

function terminatorFor(instruction: DecodedInstruction): BlockTerminator | undefined {
  switch (instruction.mnemonic) {
    case "jmp":
      return { kind: "jump", instruction, targetEip: relativeTarget(instruction) };
    case "jcc":
      return {
        kind: "conditional-branch",
        instruction,
        targetEip: relativeTarget(instruction),
        fallthroughEip: instructionEnd(instruction)
      };
    case "call":
      return {
        kind: "call",
        instruction,
        targetEip: relativeTarget(instruction),
        returnEip: instructionEnd(instruction)
      };
    case "ret":
      return { kind: "ret", instruction };
    case "int":
      return { kind: "int", instruction, vector: intVector(instruction) };
    case "unsupported":
      return { kind: "unsupported", eip: instruction.address, instruction };
    default:
      return undefined;
  }
}
