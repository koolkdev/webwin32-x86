import type { Reg32 } from "#x86/isa/types.js";
import type { IrOp } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction } from "#backends/wasm/jit/types.js";
import {
  jitVirtualValueForEffectiveAddress,
  jitVirtualValueForStorage,
  jitVirtualValueForValue,
  type JitVirtualValue
} from "./virtual-values.js";

export function recordJitVirtualLocalValue(
  op: IrOp,
  instruction: JitIrBlockInstruction,
  localValues: Map<number, JitVirtualValue>,
  virtualRegs: ReadonlyMap<Reg32, JitVirtualValue> = new Map()
): boolean {
  switch (op.op) {
    case "get32":
      recordLocalValue(
        op.dst.id,
        jitVirtualValueForStorage(op.source, instruction.operands, virtualRegs),
        localValues
      );
      return true;
    case "address32":
      recordLocalValue(
        op.dst.id,
        jitVirtualValueForEffectiveAddress(op.operand, instruction.operands, virtualRegs),
        localValues
      );
      return true;
    case "const32":
      localValues.set(op.dst.id, { kind: "const32", value: op.value });
      return true;
    case "i32.add":
    case "i32.sub":
    case "i32.xor":
    case "i32.or":
    case "i32.and":
      recordLocalValue(
        op.dst.id,
        virtualBinaryValue(op, localValues),
        localValues
      );
      return true;
    default:
      return false;
  }
}

function virtualBinaryValue(
  op: Extract<IrOp, { op: "i32.add" | "i32.sub" | "i32.xor" | "i32.or" | "i32.and" }>,
  localValues: ReadonlyMap<number, JitVirtualValue>
): JitVirtualValue | undefined {
  const a = jitVirtualValueForValue(op.a, localValues);
  const b = jitVirtualValueForValue(op.b, localValues);

  return a !== undefined && b !== undefined
    ? { kind: op.op, a, b }
    : undefined;
}

function recordLocalValue(
  dstId: number,
  value: JitVirtualValue | undefined,
  localValues: Map<number, JitVirtualValue>
): void {
  if (value === undefined) {
    localValues.delete(dstId);
  } else {
    localValues.set(dstId, value);
  }
}
