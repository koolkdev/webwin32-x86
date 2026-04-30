import type { GuestMemory, MemoryFault } from "../../core/memory/guest-memory.js";
import type { GuestMemoryDecodeRegion } from "../../arch/x86/isa/runtime/decode-reader.js";

export type RuntimeProgramRegion = Readonly<{
  baseAddress: number;
  bytes: Uint8Array<ArrayBufferLike> | readonly number[];
  generation?: number;
}>;

export type RuntimeProgramInput = RuntimeProgramRegion | readonly RuntimeProgramRegion[];

export function normalizeProgramRegions(program: RuntimeProgramInput | undefined): readonly RuntimeProgramRegion[] {
  if (program === undefined) {
    return [];
  }

  return isProgramRegion(program) ? [program] : program;
}

function isProgramRegion(program: RuntimeProgramInput): program is RuntimeProgramRegion {
  return "baseAddress" in program;
}

export function requiredProgramByteLength(program: readonly RuntimeProgramRegion[]): number | undefined {
  if (program.length === 0) {
    return undefined;
  }

  let byteLength = 0;

  for (const region of program) {
    byteLength = Math.max(byteLength, region.baseAddress + region.bytes.length);
  }

  return byteLength;
}

export function loadProgramRegions(
  memory: GuestMemory,
  program: readonly RuntimeProgramRegion[]
): MemoryFault | undefined {
  for (const region of program) {
    for (let index = 0; index < region.bytes.length; index += 1) {
      const write = memory.writeU8(region.baseAddress + index, region.bytes[index] ?? 0);

      if (!write.ok) {
        return write.fault;
      }
    }
  }

  return undefined;
}

export function programDecodeRegions(program: readonly RuntimeProgramRegion[]): readonly GuestMemoryDecodeRegion[] {
  return program.map((region) => ({
    kind: "guest-memory",
    baseAddress: region.baseAddress,
    byteLength: region.bytes.length,
    ...(region.generation === undefined ? {} : { generation: region.generation })
  }));
}
