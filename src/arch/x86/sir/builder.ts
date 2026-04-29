import type { Reg32 } from "../instruction/types.js";
import type {
  ConditionCode,
  Const32Ref,
  FlagProducerName,
  MemRef,
  NextEipRef,
  OperandInput,
  OperandRef,
  RegRef,
  SemanticTemplate,
  SirBuilder,
  SirOp,
  SirProgram,
  StorageInput,
  StorageRef,
  TargetInput,
  TargetRef,
  VarRef,
  ValueInput,
  ValueRef
} from "./types.js";

export function buildSir(template: SemanticTemplate): SirProgram {
  const builder = new ProgramSirBuilder();
  template(builder);
  return builder.program();
}

export function operand(name: string): OperandRef {
  return { kind: "operand", name };
}

export function reg32(reg: Reg32): RegRef {
  return { kind: "reg", reg };
}

export function mem32(address: ValueInput): MemRef {
  return { kind: "mem", address: toValueRef(address) };
}

export function sirVar(name: string): VarRef {
  return { kind: "var", name };
}

export function const32(value: number): Const32Ref {
  return { kind: "const32", value: value >>> 0 };
}

export function nextEip(): NextEipRef {
  return { kind: "nextEip" };
}

class ProgramSirBuilder implements SirBuilder {
  readonly #ops: SirOp[] = [];
  readonly #varCounts = new Map<string, number>();
  #terminated = false;

  #allocVar(base: string): VarRef {
    const index = this.#varCounts.get(base) ?? 0;
    this.#varCounts.set(base, index + 1);
    return sirVar(`${base}_${index}`);
  }

  #push(op: SirOp): void {
    if (this.#terminated) {
      throw new Error(`cannot emit ${op.op} after SIR terminator`);
    }

    this.#ops.push(op);

    if (isTerminator(op)) {
      this.#terminated = true;
    }
  }

  const32(value: number): Const32Ref {
    return const32(value);
  }

  nextEip(): NextEipRef {
    return nextEip();
  }

  reg32(reg: Reg32): RegRef {
    return reg32(reg);
  }

  mem32(address: ValueInput): MemRef {
    return mem32(address);
  }

  get32(source: StorageInput): VarRef {
    const dst = this.#allocVar("value");
    this.#push({ op: "get32", dst, source: toStorageRef(source) });
    return dst;
  }

  set32(target: StorageInput, value: ValueInput): void {
    this.#push({ op: "set32", target: toStorageRef(target), value: toValueRef(value) });
  }

  address32(operandInput: OperandInput): VarRef {
    const dst = this.#allocVar("address");
    this.#push({ op: "address32", dst, operand: toOperandRef(operandInput) });
    return dst;
  }

  setConst32(value: number): VarRef {
    const dst = this.#allocVar("const");
    this.#push({ op: "const32", dst, value: value >>> 0 });
    return dst;
  }

  i32Add(a: ValueInput, b: ValueInput): VarRef {
    const dst = this.#allocVar("result");
    this.#push({ op: "i32.add", dst, a: toValueRef(a), b: toValueRef(b) });
    return dst;
  }

  i32Sub(a: ValueInput, b: ValueInput): VarRef {
    const dst = this.#allocVar("result");
    this.#push({ op: "i32.sub", dst, a: toValueRef(a), b: toValueRef(b) });
    return dst;
  }

  i32Xor(a: ValueInput, b: ValueInput): VarRef {
    const dst = this.#allocVar("result");
    this.#push({ op: "i32.xor", dst, a: toValueRef(a), b: toValueRef(b) });
    return dst;
  }

  i32And(a: ValueInput, b: ValueInput): VarRef {
    const dst = this.#allocVar("result");
    this.#push({ op: "i32.and", dst, a: toValueRef(a), b: toValueRef(b) });
    return dst;
  }

  setFlags(producer: FlagProducerName, inputs: Readonly<Record<string, ValueInput>>): void {
    this.#push({
      op: "flags.set",
      producer,
      inputs: Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, toValueRef(value)]))
    });
  }

  condition(cc: ConditionCode): VarRef {
    const dst = this.#allocVar("condition");
    this.#push({ op: "condition", dst, cc });
    return dst;
  }

  next(): void {
    this.#push({ op: "next" });
  }

  jump(target: TargetInput): void {
    this.#push({ op: "jump", target: toTargetRef(target) });
  }

  conditionalJump(condition: ValueInput, taken: TargetInput, notTaken: TargetInput): void {
    this.#push({
      op: "conditionalJump",
      condition: toValueRef(condition),
      taken: toTargetRef(taken),
      notTaken: toTargetRef(notTaken)
    });
  }

  program(): SirProgram {
    if (!this.#terminated) {
      this.next();
    }

    return this.#ops;
  }
}

function isTerminator(op: SirOp): boolean {
  return op.op === "next" || op.op === "jump" || op.op === "conditionalJump";
}

function toOperandRef(value: OperandInput): OperandRef {
  return typeof value === "string" ? operand(value) : value;
}

function toStorageRef(value: StorageInput): StorageRef {
  return typeof value === "string" ? operand(value) : value;
}

function toValueRef(value: ValueInput): ValueRef {
  return typeof value === "number" ? const32(value) : value;
}

function toTargetRef(value: TargetInput): TargetRef {
  if (typeof value === "number") {
    return const32(value);
  }

  return value;
}
