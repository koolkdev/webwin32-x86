import type { Prefix } from "../instruction/prefix.js";
import type { DecodedInstruction } from "../instruction/types.js";
import type { DecodeContext } from "./decode-context.js";

export type OpcodeHandler = (context: DecodeContext, opcode: number) => DecodedInstruction;
export type PrefixForm = "operandSizeOverride";

export type DecodeTableEntry =
  | Readonly<{
      kind: "opcode";
      handler: OpcodeHandler;
      prefixForms?: Readonly<Partial<Record<PrefixForm, OpcodeHandler>>>;
    }>
  | Readonly<{ kind: "prefix"; prefix: Prefix }>;

export type DecodeTable = readonly (DecodeTableEntry | undefined)[];

export function opcodeEntry(
  handler: OpcodeHandler,
  options: Readonly<{
    prefixForms?: Readonly<Partial<Record<PrefixForm, OpcodeHandler>>>;
  }> = {}
): DecodeTableEntry {
  return {
    kind: "opcode",
    handler,
    ...options
  };
}

export function prefixEntry(prefix: Prefix): DecodeTableEntry {
  return { kind: "prefix", prefix };
}

export function handlerForPrefixForm(
  entry: Extract<DecodeTableEntry, { kind: "opcode" }>,
  context: DecodeContext
): OpcodeHandler | undefined {
  if (context.prefixes.length === 0) {
    return entry.handler;
  }

  const form = prefixForm(context);

  return form === undefined ? undefined : entry.prefixForms?.[form];
}

function prefixForm(context: DecodeContext): PrefixForm | undefined {
  return context.prefixes.length === 1 && context.prefixes[0]?.kind === "operandSizeOverride"
    ? "operandSizeOverride"
    : undefined;
}
