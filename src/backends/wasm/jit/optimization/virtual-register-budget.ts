import type { Reg32 } from "#x86/isa/types.js";
import type { IrOp } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import { materializeJitVirtualReg, type JitVirtualRewrite } from "./virtual-rewrite.js";
import {
  jitVirtualRegsReadByEffectiveAddress,
  jitVirtualValueCost,
  type JitVirtualValue
} from "./virtual-values.js";

const maxRepeatedInlineVirtualValueCost = 2;
const maxRetainedVirtualValueCost = 8;

export function shouldRetainVirtualRegisterValue(value: JitVirtualValue): boolean {
  return jitVirtualValueCost(value) <= maxRetainedVirtualValueCost;
}

export function shouldMaterializeRepeatedVirtualRegisterRead(
  reg: Reg32,
  value: JitVirtualValue,
  virtualRegReadCounts: ReadonlyMap<Reg32, number>
): boolean {
  return (
    (virtualRegReadCounts.get(reg) ?? 0) > 0 &&
    jitVirtualValueCost(value) > maxRepeatedInlineVirtualValueCost
  );
}

export function materializeRepeatedEffectiveAddressReads(
  op: Extract<IrOp, { op: "address32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitVirtualRewrite,
  virtualRegs: Map<Reg32, JitVirtualValue>,
  virtualRegReadCounts: Map<Reg32, number>
): number {
  let materializedSetCount = 0;

  for (const reg of jitVirtualRegsReadByEffectiveAddress(op.operand, instruction.operands, virtualRegs)) {
    const value = virtualRegs.get(reg);

    if (value !== undefined && shouldMaterializeRepeatedVirtualRegisterRead(reg, value, virtualRegReadCounts)) {
      materializeJitVirtualReg(rewrite, reg, value);
      virtualRegs.delete(reg);
      virtualRegReadCounts.delete(reg);
      materializedSetCount += 1;
    }
  }

  return materializedSetCount;
}

export function syncVirtualRegReadCounts(
  virtualRegReadCounts: Map<Reg32, number>,
  virtualRegs: ReadonlyMap<Reg32, JitVirtualValue>
): void {
  for (const reg of virtualRegReadCounts.keys()) {
    if (!virtualRegs.has(reg)) {
      virtualRegReadCounts.delete(reg);
    }
  }
}
