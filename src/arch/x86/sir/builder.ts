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

export type SirProgramSegment = Readonly<{
  opStart: number;
  opEnd: number;
  operandStart: number;
  operandEnd: number;
  terminator: SirProgramTerminator;
}>;

export type SirProgramTerminator = "next" | "jump" | "conditionalJump" | "hostTrap";

export type SirProgramSequence = Readonly<{
  program: SirProgram;
  segments: readonly SirProgramSegment[];
  operandCount: number;
}>;

export type AppendSirProgramOptions = Readonly<{
  operandCount: number;
}>;

export function buildSir(template: SemanticTemplate): SirProgram {
  const builder = new TemplateSirBuilder(0, 0);

  template(builder);
  return builder.program();
}

export class SirProgramSequenceBuilder {
  readonly #ops: SirOp[] = [];
  readonly #segments: SirProgramSegment[] = [];
  #nextVarId = 0;
  #nextOperandIndex = 0;

  append(template: SemanticTemplate, options: AppendSirProgramOptions): SirProgramSegment {
    const opStart = this.#ops.length;
    const operandStart = this.#nextOperandIndex;
    const builder = new TemplateSirBuilder(this.#nextVarId, operandStart, options.operandCount);

    template(builder);
    const program = builder.program();

    this.#nextVarId = builder.nextVarId();
    this.#ops.push(...program);

    const segment = {
      opStart,
      opEnd: this.#ops.length,
      operandStart,
      operandEnd: operandStart + options.operandCount,
      terminator: programTerminator(program)
    };

    this.#nextOperandIndex = segment.operandEnd;
    this.#segments.push(segment);
    return segment;
  }

  build(): SirProgramSequence {
    return {
      program: [...this.#ops],
      segments: [...this.#segments],
      operandCount: this.#nextOperandIndex
    };
  }
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

class TemplateSirBuilder implements SirBuilder {
  readonly #ops: SirOp[] = [];
  #nextVarId: number;
  readonly #operandIndexBase: number;
  readonly #operandCount: number | undefined;
  #terminated = false;

  constructor(firstVarId: number, operandIndexBase: number, operandCount?: number) {
    assertVarId(firstVarId);
    assertOperandIndex(operandIndexBase);
    if (operandCount !== undefined) {
      assertOperandIndex(operandCount);
    }

    this.#nextVarId = firstVarId;
    this.#operandIndexBase = operandIndexBase;
    this.#operandCount = operandCount;
  }

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
    if (this.#operandCount !== undefined && index >= this.#operandCount) {
      throw new Error(`SIR operand ${index} does not exist in ${this.#operandCount}-operand segment`);
    }

    return operand(this.#operandIndexBase + index);
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

  nextVarId(): number {
    return this.#nextVarId;
  }
}

function isTerminator(op: SirOp): op is Extract<SirOp, { op: SirProgramTerminator }> {
  return op.op === "next" || op.op === "jump" || op.op === "conditionalJump" || op.op === "hostTrap";
}

function programTerminator(program: SirProgram): SirProgramTerminator {
  const terminator = program[program.length - 1];

  if (terminator === undefined || !isTerminator(terminator)) {
    throw new Error("SIR program is missing a terminator");
  }

  return terminator.op;
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
