import type { Reg32 } from "#x86/isa/types.js";
import { materializeJitRegisterValue, type JitInstructionRewrite } from "./rewrite.js";
import type { JitEffectIndex } from "./effects.js";
import {
  jitInstructionHasPreInstructionExit,
  jitOpHasPostInstructionExit
} from "./effects.js";
import { JitRegisterValues } from "./register-values.js";
import { jitValueReadsReg } from "./values.js";

export function materializeRegisterValuesForPreInstructionExits(
  rewrite: JitInstructionRewrite,
  effects: JitEffectIndex,
  instructionIndex: number,
  registers: JitRegisterValues
): number {
  if (!jitInstructionHasPreInstructionExit(effects, instructionIndex)) {
    return 0;
  }

  return materializeAllRegisterValues(rewrite, registers);
}

export function materializeRegisterValuesForPostInstructionExit(
  rewrite: JitInstructionRewrite,
  effects: JitEffectIndex,
  instructionIndex: number,
  opIndex: number,
  registers: JitRegisterValues
): number {
  if (!jitOpHasPostInstructionExit(effects, instructionIndex, opIndex)) {
    return 0;
  }

  return materializeAllRegisterValues(rewrite, registers);
}

export function materializeRegisterValuesReadingReg(
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues,
  readReg: Reg32
): number {
  let materializedSetCount = 0;

  for (const [reg, value] of [...registers.entries()]) {
    if (reg !== readReg && jitValueReadsReg(value, readReg)) {
      materializeJitRegisterValue(rewrite, reg, value);
      registers.delete(reg);
      materializedSetCount += 1;
    }
  }

  return materializedSetCount;
}

export function materializeAllRegisterValues(
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues
): number {
  const materializedSetCount = registers.size;

  for (const [reg, value] of registers.entries()) {
    materializeJitRegisterValue(rewrite, reg, value);
  }

  registers.clear();
  return materializedSetCount;
}

export function materializeRegisterValuesForRead(
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

    materializeJitRegisterValue(rewrite, reg, value);
    registers.delete(reg);
    materializedSetCount += 1;
  }

  return materializedSetCount;
}
