import type { Reg32 } from "#x86/isa/types.js";
import { materializeJitVirtualReg, type JitInstructionRewrite } from "./rewrite.js";
import type { JitOptimizationEventIndex } from "./events.js";
import {
  jitInstructionHasPreInstructionExit,
  jitOpHasPostInstructionExit
} from "./events.js";
import { jitVirtualValueReadsReg, type JitVirtualValue } from "./virtual-values.js";

export function materializeVirtualRegsForPreInstructionExits(
  rewrite: JitInstructionRewrite,
  events: JitOptimizationEventIndex,
  instructionIndex: number,
  virtualRegs: Map<Reg32, JitVirtualValue>,
  virtualRegReadCounts: Map<Reg32, number>
): number {
  if (!jitInstructionHasPreInstructionExit(events, instructionIndex)) {
    return 0;
  }

  const materializedSetCount = materializeAllVirtualRegs(rewrite, virtualRegs);

  virtualRegReadCounts.clear();
  return materializedSetCount;
}

export function materializeVirtualRegsForPostInstructionExit(
  rewrite: JitInstructionRewrite,
  events: JitOptimizationEventIndex,
  instructionIndex: number,
  opIndex: number,
  virtualRegs: Map<Reg32, JitVirtualValue>,
  virtualRegReadCounts: Map<Reg32, number>
): number {
  if (!jitOpHasPostInstructionExit(events, instructionIndex, opIndex)) {
    return 0;
  }

  const materializedSetCount = materializeAllVirtualRegs(rewrite, virtualRegs);

  if (materializedSetCount !== 0) {
    virtualRegReadCounts.clear();
  }

  return materializedSetCount;
}

export function materializeVirtualRegsReadingReg(
  rewrite: JitInstructionRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>,
  readReg: Reg32
): number {
  let materializedSetCount = 0;

  for (const [reg, value] of [...virtualRegs]) {
    if (reg !== readReg && jitVirtualValueReadsReg(value, readReg)) {
      materializeJitVirtualReg(rewrite, reg, value);
      virtualRegs.delete(reg);
      materializedSetCount += 1;
    }
  }

  return materializedSetCount;
}

export function materializeAllVirtualRegs(
  rewrite: JitInstructionRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>
): number {
  const materializedSetCount = virtualRegs.size;

  for (const [reg, value] of virtualRegs) {
    materializeJitVirtualReg(rewrite, reg, value);
  }

  virtualRegs.clear();
  return materializedSetCount;
}

export function materializeVirtualRegsForRead(
  rewrite: JitInstructionRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>,
  readRegs: readonly Reg32[]
): number {
  let materializedSetCount = 0;

  for (const reg of readRegs) {
    const value = virtualRegs.get(reg);

    if (value === undefined) {
      continue;
    }

    materializeJitVirtualReg(rewrite, reg, value);
    virtualRegs.delete(reg);
    materializedSetCount += 1;
  }

  return materializedSetCount;
}
