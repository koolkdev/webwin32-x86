import type { Reg32 } from "#x86/isa/types.js";
import type { IrOp } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import type { JitInstructionRewrite } from "#backends/wasm/jit/optimization/ir/rewrite.js";
import { JitRegisterValues } from "#backends/wasm/jit/optimization/registers/values.js";
import {
  jitTrackedRegisterLocation,
  type JitTrackedLocation,
  type JitTrackedState
} from "#backends/wasm/jit/optimization/tracked/state.js";
import {
  jitValueCost,
  type JitValue
} from "#backends/wasm/jit/optimization/ir/values.js";

const maxRepeatedInlineRegisterValueCost = 2;
const maxRetainedRegisterValueCost = 8;

export function shouldRetainRegisterValue(value: JitValue): boolean {
  return jitValueCost(value) <= maxRetainedRegisterValueCost;
}

export function shouldMaterializeRepeatedRegisterRead(
  reg: Reg32,
  value: JitValue,
  registers: JitRegisterValues
): boolean {
  return (
    registers.readCount(reg) > 0 &&
    jitValueCost(value) > maxRepeatedInlineRegisterValueCost
  );
}

export function materializeRepeatedEffectiveAddressReads(
  op: Extract<IrOp, { op: "address32" }>,
  instruction: JitIrBlockInstruction,
  rewrite: JitInstructionRewrite,
  tracked: JitTrackedState
): number {
  const { registers } = tracked;
  const locations: JitTrackedLocation[] = [];

  for (const reg of registers.regsReadByEffectiveAddress(op.operand, instruction.operands)) {
    const value = registers.get(reg);

    if (value !== undefined && shouldMaterializeRepeatedRegisterRead(reg, value, registers)) {
      locations.push(jitTrackedRegisterLocation(reg));
    }
  }

  return tracked.materializeRequiredLocations(rewrite, {
    kind: "locations",
    reason: "read",
    locations
  });
}

export function syncRegisterReadCounts(registers: JitRegisterValues): void {
  registers.syncReadCounts();
}
