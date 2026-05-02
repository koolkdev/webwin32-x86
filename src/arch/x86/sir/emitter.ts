import type { Reg32 } from "../isa/types.js";
import {
  const32,
  mem32,
  nextEip,
  operand,
  reg32,
  sirVar,
  toStorageRef,
  toTargetRef,
  toValueRef
} from "./refs.js";
import type {
  ConditionCode,
  Const32Ref,
  FlagMask,
  FlagProducerName,
  MemRef,
  NextEipRef,
  OperandInput,
  OperandRef,
  RegRef,
  SirBuilder,
  SirOp,
  SirProgram,
  StorageInput,
  TargetInput,
  VarRef,
  ValueInput
} from "./types.js";

export type SirProgramTerminator = "next" | "jump" | "conditionalJump" | "hostTrap";

export type SirEmitterOptions = Readonly<{
  ops?: SirOp[];
  allocateVar?: () => VarRef;
  resolveOperand?: (index: number) => OperandRef;
}>;

export class SirEmitter implements SirBuilder {
  readonly #ops: SirOp[];
  readonly #allocateVarOverride: (() => VarRef) | undefined;
  readonly #resolveOperand: (index: number) => OperandRef;
  #nextVarId = 0;
  #terminator: SirProgramTerminator | undefined;

  constructor(options: SirEmitterOptions = {}) {
    this.#ops = options.ops ?? [];
    this.#allocateVarOverride = options.allocateVar;
    this.#resolveOperand = options.resolveOperand ?? operand;
  }

  #allocVar(): VarRef {
    if (this.#allocateVarOverride !== undefined) {
      return this.#allocateVarOverride();
    }

    const id = this.#nextVarId;

    this.#nextVarId += 1;
    return sirVar(id);
  }

  #push(op: SirOp): void {
    if (this.#terminator !== undefined) {
      throw new Error(`cannot emit ${op.op} after SIR terminator`);
    }

    this.#ops.push(op);

    if (isSirTerminator(op)) {
      this.#terminator = op.op;
    }
  }

  operand(index: number): OperandRef {
    return this.#resolveOperand(index);
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

  materializeFlags(mask: FlagMask): void {
    this.#push({ op: "flags.materialize", mask });
  }

  boundaryFlags(mask: FlagMask): void {
    this.#push({ op: "flags.boundary", mask });
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

  finish(): SirProgramTerminator {
    if (this.#terminator === undefined) {
      this.next();
    }

    if (this.#terminator === undefined) {
      throw new Error("SIR program is missing a terminator");
    }

    return this.#terminator;
  }

  program(): SirProgram {
    this.finish();
    return [...this.#ops];
  }
}

export function sirProgramTerminator(program: SirProgram): SirProgramTerminator {
  const terminator = program[program.length - 1];

  if (terminator === undefined || !isSirTerminator(terminator)) {
    throw new Error("SIR program is missing a terminator");
  }

  return terminator.op;
}

function isSirTerminator(op: SirOp): op is Extract<SirOp, { op: SirProgramTerminator }> {
  return op.op === "next" || op.op === "jump" || op.op === "conditionalJump" || op.op === "hostTrap";
}
