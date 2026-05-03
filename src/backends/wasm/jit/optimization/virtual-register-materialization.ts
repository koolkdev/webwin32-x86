import type { Reg32 } from "#x86/isa/types.js";
import { materializeJitVirtualReg, type JitInstructionRewrite } from "./rewrite.js";
import type { JitEffectIndex } from "./effects.js";
import {
  jitInstructionHasPreInstructionExit,
  jitOpHasPostInstructionExit
} from "./effects.js";
import { jitValueReadsReg, type JitValue } from "./values.js";

export function materializeVirtualRegsForPreInstructionExits(
  rewrite: JitInstructionRewrite,
  effects: JitEffectIndex,
  instructionIndex: number,
  virtualRegs: Map<Reg32, JitValue>,
  virtualRegReadCounts: Map<Reg32, number>
): number {
  if (!jitInstructionHasPreInstructionExit(effects, instructionIndex)) {
    return 0;
  }

  const materializedSetCount = materializeAllVirtualRegs(rewrite, virtualRegs);

  virtualRegReadCounts.clear();
  return materializedSetCount;
}

export function materializeVirtualRegsForPostInstructionExit(
  rewrite: JitInstructionRewrite,
  effects: JitEffectIndex,
  instructionIndex: number,
  opIndex: number,
  virtualRegs: Map<Reg32, JitValue>,
  virtualRegReadCounts: Map<Reg32, number>
): number {
  if (!jitOpHasPostInstructionExit(effects, instructionIndex, opIndex)) {
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
  virtualRegs: Map<Reg32, JitValue>,
  readReg: Reg32
): number {
  let materializedSetCount = 0;

  for (const [reg, value] of [...virtualRegs]) {
    if (reg !== readReg && jitValueReadsReg(value, readReg)) {
      materializeJitVirtualReg(rewrite, reg, value);
      virtualRegs.delete(reg);
      materializedSetCount += 1;
    }
  }

  return materializedSetCount;
}

export function materializeAllVirtualRegs(
  rewrite: JitInstructionRewrite,
  virtualRegs: Map<Reg32, JitValue>
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
  virtualRegs: Map<Reg32, JitValue>,
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
