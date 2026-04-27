import type { Prefix } from "../instruction/prefix.js";
import type { DecodedInstruction } from "../instruction/types.js";
import { ByteReader } from "./byte-reader.js";
import type { DecodeContext } from "./decode-context.js";
import { ensureInstructionBytes, maxInstructionLength, throwDecodeError } from "./decode-bounds.js";
import { handlerForPrefixForm, type DecodeTableEntry } from "./decode-table.js";
import { unsupportedInstruction } from "./instruction.js";
import { opcodeHandlers } from "./opcode-handlers.js";

export function decodeOne(
  bytes: Uint8Array<ArrayBufferLike>,
  offset: number,
  address: number
): DecodedInstruction {
  const reader = new ByteReader(bytes);

  return decodeInstruction(reader, offset, address);
}

function decodeInstruction(reader: ByteReader, offset: number, address: number): DecodedInstruction {
  const prefixes: Prefix[] = [];
  let currentOffset = offset;

  while (true) {
    ensureDispatchByte(reader, currentOffset, address, offset);

    const value = reader.readU8(currentOffset);
    const entry = opcodeHandlers[value];

    if (entry?.kind === "prefix") {
      prefixes.push(entry.prefix);
      currentOffset += 1;
      continue;
    }

    const context: DecodeContext = {
      reader,
      address,
      offset,
      prefixes,
      opcodeOffset: currentOffset
    };

    return decodeOpcodeEntry(context, value, entry);
  }
}

function decodeOpcodeEntry(
  context: DecodeContext,
  value: number,
  entry: DecodeTableEntry | undefined
): DecodedInstruction {
  if (entry?.kind === "opcode") {
    const handler = handlerForPrefixForm(entry, context);

    if (handler !== undefined) {
      return handler(context, value);
    }

    return unhandledPrefixedInstruction(context);
  }

  return unsupportedInstruction(context, context.opcodeOffset + 1);
}

function ensureDispatchByte(reader: ByteReader, readOffset: number, address: number, instructionOffset: number): void {
  if (readOffset - instructionOffset >= maxInstructionLength) {
    throwDecodeError(readOffset >= reader.length ? "truncated" : "instructionTooLong", reader, address, instructionOffset);
  }

  ensureInstructionBytes(reader, readOffset, 1, address, instructionOffset);
}

function unhandledPrefixedInstruction(context: DecodeContext): DecodedInstruction {
  const length = context.prefixes.length + 1;

  ensureInstructionBytes(context.reader, context.offset, length, context.address, context.offset);

  return unsupportedInstruction(context, context.offset + length);
}
