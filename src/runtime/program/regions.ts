export type RuntimeProgramRegion = Readonly<{
  baseAddress: number;
  bytes: Uint8Array<ArrayBufferLike> | readonly number[];
  generation?: number;
}>;

export type RuntimeProgramInput = RuntimeProgramRegion | readonly RuntimeProgramRegion[];

export type RuntimeCodeRegion = Readonly<{
  baseAddress: number;
  byteLength: number;
  generation?: number;
}>;

export function normalizeProgramRegions(input: RuntimeProgramInput | undefined): readonly RuntimeProgramRegion[] {
  if (input === undefined) {
    return [];
  }

  return isProgramRegion(input) ? [input] : input;
}

export function codeRegionsFromProgram(regions: readonly RuntimeProgramRegion[]): readonly RuntimeCodeRegion[] {
  return regions.map((region) => ({
    baseAddress: region.baseAddress,
    byteLength: region.bytes.length,
    ...(region.generation === undefined ? {} : { generation: region.generation })
  }));
}

export function requiredProgramByteLength(regions: readonly RuntimeProgramRegion[]): number | undefined {
  if (regions.length === 0) {
    return undefined;
  }

  let byteLength = 0;

  for (const region of regions) {
    byteLength = Math.max(byteLength, regionEnd(region));
  }

  return byteLength;
}

export function regionContains(region: RuntimeCodeRegion, address: number): boolean {
  const offset = address - region.baseAddress;

  return offset >= 0 && offset < region.byteLength;
}

export function regionEnd(region: RuntimeCodeRegion | RuntimeProgramRegion): number {
  const byteLength = "bytes" in region ? region.bytes.length : region.byteLength;

  return region.baseAddress + byteLength;
}

function isProgramRegion(input: RuntimeProgramInput): input is RuntimeProgramRegion {
  return "baseAddress" in input;
}
