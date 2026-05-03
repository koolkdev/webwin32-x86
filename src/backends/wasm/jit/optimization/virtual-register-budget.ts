import type { Reg32 } from "#x86/isa/types.js";
import type { IrOp } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import { materializeJitVirtualReg, type JitInstructionRewrite } from "./rewrite.js";
import { JitRegisterValues } from "./register-values.js";
import {
  jitValueCost,
  type JitValue
} from "./values.js";

const maxRepeatedInlineVirtualValueCost = 2;
const maxRetainedVirtualValueCost = 8;

export function shouldRetainVirtualRegisterValue(value: JitValue): boolean {
  return jitValueCost(value) <= maxRetainedVirtualValueCost;
}

export function shouldMaterializeRepeatedVirtualRegisterRead(
  reg: Reg32,
  value: JitValue,
  registers: JitRegisterValues
): boolean {
  return (
    registers.readCount(reg) > 0 &&
    jitValueCost(value) > maxRepeatedInlineVirtualValueCost
  );
}

export function materializeRepeatedEffectiveAddressReads(
  op: Extract<IrOp, { op: "address32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  registers: JitRegisterValues
): number {
  let materializedSetCount = 0;

  for (const reg of registers.regsReadByEffectiveAddress(op.operand, instruction.operands)) {
    const value = registers.get(reg);

    if (value !== undefined && shouldMaterializeRepeatedVirtualRegisterRead(reg, value, registers)) {
      materializeJitVirtualReg(rewrite, reg, value);
      registers.delete(reg);
      materializedSetCount += 1;
    }
  }

  return materializedSetCount;
}

export function syncVirtualRegReadCounts(registers: JitRegisterValues): void {
  registers.syncReadCounts();
}
