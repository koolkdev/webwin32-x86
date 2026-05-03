import type { Reg32 } from "#x86/isa/types.js";
import { materializeJitVirtualReg, type JitInstructionRewrite } from "./rewrite.js";
import type { JitEffectIndex } from "./effects.js";
import {
  jitInstructionHasPreInstructionExit,
  jitOpHasPostInstructionExit
} from "./effects.js";
import { JitRegisterValues } from "./register-values.js";
import { jitValueReadsReg } from "./values.js";

export function materializeVirtualRegsForPreInstructionExits(
  rewrite: JitInstructionRewrite,
  effects: JitEffectIndex,
  instructionIndex: number,
  registers: JitRegisterValues
): number {
  if (!jitInstructionHasPreInstructionExit(effects, instructionIndex)) {
    return 0;
  }

  return materializeAllVirtualRegs(rewrite, registers);
}

export function materializeVirtualRegsForPostInstructionExit(
  rewrite: JitInstructionRewrite,
  effects: JitEffectIndex,
  instructionIndex: number,
  opIndex: number,
  registers: JitRegisterValues
): number {
  if (!jitOpHasPostInstructionExit(effects, instructionIndex, opIndex)) {
    return 0;
  }

  return materializeAllVirtualRegs(rewrite, registers);
}

export function materializeVirtualRegsReadingReg(
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues,
  readReg: Reg32
): number {
  let materializedSetCount = 0;

  for (const [reg, value] of [...registers.entries()]) {
    if (reg !== readReg && jitValueReadsReg(value, readReg)) {
      materializeJitVirtualReg(rewrite, reg, value);
      registers.delete(reg);
      materializedSetCount += 1;
    }
  }

  return materializedSetCount;
}

export function materializeAllVirtualRegs(
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues
): number {
  const materializedSetCount = registers.size;

  for (const [reg, value] of registers.entries()) {
    materializeJitVirtualReg(rewrite, reg, value);
  }

  registers.clear();
  return materializedSetCount;
}

export function materializeVirtualRegsForRead(
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues,
  readRegs: readonly Reg32[]
): number {
  let materializedSetCount = 0;

  for (const reg of readRegs) {
    const value = registers.get(reg);

    if (value === undefined) {
      continue;
    }

    materializeJitVirtualReg(rewrite, reg, value);
    registers.delete(reg);
    materializedSetCount += 1;
  }

  return materializedSetCount;
}
