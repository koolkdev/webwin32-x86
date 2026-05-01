import type { GuestMemory, MemoryFault } from "../../core/memory/guest-memory.js";
import type { RuntimeProgramRegion } from "./regions.js";

export function loadProgramRegions(
  memory: GuestMemory,
  regions: readonly RuntimeProgramRegion[]
): MemoryFault | undefined {
  for (const region of regions) {
    const fault = loadProgramRegion(memory, region);

    if (fault !== undefined) {
      return fault;
    }
  }

  return undefined;
}

function loadProgramRegion(memory: GuestMemory, region: RuntimeProgramRegion): MemoryFault | undefined {
  for (let index = 0; index < region.bytes.length; index += 1) {
    const write = memory.writeU8(region.baseAddress + index, region.bytes[index] ?? 0);

    if (!write.ok) {
      return write.fault;
    }
  }

  return undefined;
}
