export const prefixByte = {
  operandSizeOverride: 0x66,
  addressSizeOverride: 0x67,
  repne: 0xf2,
  rep: 0xf3,
  csSegmentOverride: 0x2e,
  ssSegmentOverride: 0x36,
  dsSegmentOverride: 0x3e,
  esSegmentOverride: 0x26,
  fsSegmentOverride: 0x64,
  gsSegmentOverride: 0x65
} as const;

export type SegmentRegister = "cs" | "ss" | "ds" | "es" | "fs" | "gs";

export type Prefix =
  | Readonly<{ kind: "operandSizeOverride"; byte: typeof prefixByte.operandSizeOverride }>
  | Readonly<{ kind: "addressSizeOverride"; byte: typeof prefixByte.addressSizeOverride }>
  | Readonly<{ kind: "repne"; byte: typeof prefixByte.repne }>
  | Readonly<{ kind: "rep"; byte: typeof prefixByte.rep }>
  | Readonly<{
      kind: "segmentOverride";
      byte:
        | typeof prefixByte.csSegmentOverride
        | typeof prefixByte.ssSegmentOverride
        | typeof prefixByte.dsSegmentOverride
        | typeof prefixByte.esSegmentOverride
        | typeof prefixByte.fsSegmentOverride
        | typeof prefixByte.gsSegmentOverride;
      segment: SegmentRegister;
    }>;

export const instructionPrefixes = [
  { kind: "operandSizeOverride", byte: prefixByte.operandSizeOverride },
  { kind: "addressSizeOverride", byte: prefixByte.addressSizeOverride },
  { kind: "repne", byte: prefixByte.repne },
  { kind: "rep", byte: prefixByte.rep },
  { kind: "segmentOverride", byte: prefixByte.csSegmentOverride, segment: "cs" },
  { kind: "segmentOverride", byte: prefixByte.ssSegmentOverride, segment: "ss" },
  { kind: "segmentOverride", byte: prefixByte.dsSegmentOverride, segment: "ds" },
  { kind: "segmentOverride", byte: prefixByte.esSegmentOverride, segment: "es" },
  { kind: "segmentOverride", byte: prefixByte.fsSegmentOverride, segment: "fs" },
  { kind: "segmentOverride", byte: prefixByte.gsSegmentOverride, segment: "gs" }
] as const satisfies readonly Prefix[];
