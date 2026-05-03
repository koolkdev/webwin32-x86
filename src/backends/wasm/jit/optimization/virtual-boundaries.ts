import type { Reg32 } from "#x86/isa/types.js";
import { materializeJitVirtualReg, type JitVirtualRewrite } from "./virtual-rewrite.js";
import { jitVirtualValueReadsReg, type JitVirtualValue } from "./virtual-values.js";

export function materializeVirtualRegsReadingReg(
  rewrite: JitVirtualRewrite,
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
  rewrite: JitVirtualRewrite,
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
  rewrite: JitVirtualRewrite,
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
