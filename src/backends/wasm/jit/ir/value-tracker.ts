import type { Reg32 } from "#x86/isa/types.js";
import { irOpIsBinaryValue } from "#x86/ir/model/op-semantics.js";
import type { IrBinaryValueOp, ValueRef } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/ir/types.js";
import {
  jitValueForEffectiveAddress,
  jitValueForStorage,
  jitValueForValue,
  jitValuesEqual,
  type JitValue
} from "#backends/wasm/jit/ir/values.js";

export class JitValueTracker {
  private readonly locals = new Map<number, JitValue>();

  clear(): void {
    this.locals.clear();
  }

  valueFor(value: ValueRef): JitValue | undefined {
    return jitValueForValue(value, this.locals);
  }

  record(id: number, value: JitValue | undefined): void {
    if (value === undefined) {
      this.locals.delete(id);
    } else {
      this.locals.set(id, value);
    }
  }

  recordOp(
    op: JitIrOp,
    instruction: JitIrBlockInstruction,
    registerValues: ReadonlyMap<Reg32, JitValue> = new Map()
  ): boolean {
    switch (op.op) {
      case "get":
        this.record(op.dst.id, (op.accessWidth ?? 32) === 32
          ? jitValueForStorage(op.source, instruction.operands, registerValues)
          : undefined);
        return true;
      case "address":
        this.record(
          op.dst.id,
          jitValueForEffectiveAddress(op.operand, instruction.operands, registerValues)
        );
        return true;
      case "const32":
        this.record(op.dst.id, { kind: "const32", value: op.value });
        return true;
      default:
        if (irOpIsBinaryValue(op)) {
          this.record(op.dst.id, this.binaryValue(op));
          return true;
        }

        return false;
    }
  }

  refFor(value: JitValue): ValueRef | undefined {
    if (value.kind === "const32") {
      return { kind: "const32", value: value.value };
    }

    for (const [id, localValue] of this.locals) {
      if (jitValuesEqual(localValue, value)) {
        return { kind: "var", id };
      }
    }

    return undefined;
  }

  private binaryValue(op: Extract<JitIrOp, IrBinaryValueOp>): JitValue | undefined {
    const a = this.valueFor(op.a);
    const b = this.valueFor(op.b);

    return a !== undefined && b !== undefined
      ? { kind: op.op, a, b }
      : undefined;
  }
}
