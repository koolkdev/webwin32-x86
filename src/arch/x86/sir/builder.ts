import type { Reg32 } from "../isa/types.js";
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

export function operand(index: number): OperandRef {
  assertOperandIndex(index);
  return { kind: "operand", index };
}

export function reg32(reg: Reg32): RegRef {
  return { kind: "reg", reg };
}

export function mem32(address: ValueInput): MemRef {
  return { kind: "mem", address: toValueRef(address) };
}

export function sirVar(id: number): VarRef {
  assertVarId(id);
  return { kind: "var", id };
}

export function const32(value: number): Const32Ref {
  return { kind: "const32", value: value >>> 0 };
}

export function nextEip(): NextEipRef {
  return { kind: "nextEip" };
}

class ProgramSirBuilder implements SirBuilder {
  readonly #ops: SirOp[] = [];
  #nextVarId = 0;
  #terminated = false;

  #allocVar(): VarRef {
    const id = this.#nextVarId;
    this.#nextVarId += 1;
    return sirVar(id);
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

  operand(index: number): OperandRef {
    return operand(index);
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
    const dst = this.#allocVar();
    this.#push({ op: "get32", dst, source: toStorageRef(source) });
    return dst;
  }

  set32(target: StorageInput, value: ValueInput): void {
    this.#push({ op: "set32", target: toStorageRef(target), value: toValueRef(value) });
  }

  address32(operandInput: OperandInput): VarRef {
    const dst = this.#allocVar();
    this.#push({ op: "address32", dst, operand: operandInput });
    return dst;
  }

  setConst32(value: number): VarRef {
    const dst = this.#allocVar();
    this.#push({ op: "const32", dst, value: value >>> 0 });
    return dst;
  }

  i32Add(a: ValueInput, b: ValueInput): VarRef {
    const dst = this.#allocVar();
    this.#push({ op: "i32.add", dst, a: toValueRef(a), b: toValueRef(b) });
    return dst;
  }

  i32Sub(a: ValueInput, b: ValueInput): VarRef {
    const dst = this.#allocVar();
    this.#push({ op: "i32.sub", dst, a: toValueRef(a), b: toValueRef(b) });
    return dst;
  }

  i32Xor(a: ValueInput, b: ValueInput): VarRef {
    const dst = this.#allocVar();
    this.#push({ op: "i32.xor", dst, a: toValueRef(a), b: toValueRef(b) });
    return dst;
  }

  i32And(a: ValueInput, b: ValueInput): VarRef {
    const dst = this.#allocVar();
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
    const dst = this.#allocVar();
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

  hostTrap(vector: ValueInput): void {
    this.#push({ op: "hostTrap", vector: toValueRef(vector) });
  }

  program(): SirProgram {
    if (!this.#terminated) {
      this.next();
    }

    return this.#ops;
  }
}

function isTerminator(op: SirOp): boolean {
  return op.op === "next" || op.op === "jump" || op.op === "conditionalJump" || op.op === "hostTrap";
}

function toStorageRef(value: StorageInput): StorageRef {
  return value;
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

function assertOperandIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`operand index must be a non-negative integer, got ${index}`);
  }
}

function assertVarId(id: number): void {
  if (!Number.isInteger(id) || id < 0) {
    throw new Error(`SIR var id must be a non-negative integer, got ${id}`);
  }
}
