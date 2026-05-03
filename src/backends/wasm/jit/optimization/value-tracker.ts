import type { Reg32 } from "#x86/isa/types.js";
import type { ValueRef } from "#x86/ir/model/types.js";
import type { JitIrBlockInstruction, JitIrOp } from "#backends/wasm/jit/types.js";
import {
  jitValueForEffectiveAddress,
  jitValueForStorage,
  jitValueForValue,
  type JitValue
} from "./values.js";

export class JitValueTracker {
  readonly locals = new Map<number, JitValue>();

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
    virtualRegs: ReadonlyMap<Reg32, JitValue> = new Map()
  ): boolean {
    switch (op.op) {
      case "get32":
        this.record(
          op.dst.id,
          jitValueForStorage(op.source, instruction.operands, virtualRegs)
        );
        return true;
      case "address32":
        this.record(
          op.dst.id,
          jitValueForEffectiveAddress(op.operand, instruction.operands, virtualRegs)
        );
        return true;
      case "const32":
        this.record(op.dst.id, { kind: "const32", value: op.value });
        return true;
      case "i32.add":
      case "i32.sub":
      case "i32.xor":
      case "i32.or":
      case "i32.and":
        this.record(op.dst.id, this.binaryValue(op));
        return true;
      default:
        return false;
    }
  }

  refFor(value: JitValue): ValueRef | undefined {
    if (value.kind === "const32") {
      return { kind: "const32", value: value.value };
    }

    for (const [id, localValue] of this.locals) {
      if (localValue === value) {
        return { kind: "var", id };
      }
    }

    return undefined;
  }

  private binaryValue(
    op: Extract<JitIrOp, { op: "i32.add" | "i32.sub" | "i32.xor" | "i32.or" | "i32.and" }>
  ): JitValue | undefined {
    const a = this.valueFor(op.a);
    const b = this.valueFor(op.b);

    return a !== undefined && b !== undefined
      ? { kind: op.op, a, b }
      : undefined;
  }
}
