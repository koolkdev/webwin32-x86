import type { Reg32 } from "#x86/isa/types.js";
import { createIrFlagSetOp } from "#x86/ir/model/flags.js";
import { isIrTerminatorOp, type IrTerminatorOp } from "#x86/ir/model/ops.js";
import {
  const32,
  mem32,
  nextEip,
  operand,
  reg32,
  irVar,
  toStorageRef,
  toTargetRef,
  toValueRef
} from "#x86/ir/model/refs.js";
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
  IrBuilder,
  IrOp,
  IrBlock,
  StorageInput,
  TargetInput,
  VarRef,
  ValueInput
} from "#x86/ir/model/types.js";

export type IrBlockTerminator = IrTerminatorOp["op"];

export type IrEmitterOptions = Readonly<{
  ops?: IrOp[];
  allocateVar?: () => VarRef;
  resolveOperand?: (index: number) => OperandRef;
}>;

export class IrEmitter implements IrBuilder {
  readonly #ops: IrOp[];
  readonly #allocateVarOverride: (() => VarRef) | undefined;
  readonly #resolveOperand: (index: number) => OperandRef;
  #nextVarId = 0;
  #terminator: IrBlockTerminator | undefined;

  constructor(options: IrEmitterOptions = {}) {
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
    return irVar(id);
  }

  #push(op: IrOp): void {
    if (this.#terminator !== undefined) {
      throw new Error(`cannot emit ${op.op} after IR terminator`);
    }

    this.#ops.push(op);

    if (isIrTerminatorOp(op)) {
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

  set32If(condition: ValueInput, target: StorageInput, value: ValueInput): void {
    this.#push({
      op: "set32.if",
      condition: toValueRef(condition),
      target: toStorageRef(target),
      value: toValueRef(value)
    });
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

  i32Or(a: ValueInput, b: ValueInput): VarRef {
    const dst = this.#allocVar();

    this.#push({ op: "i32.or", dst, a: toValueRef(a), b: toValueRef(b) });
    return dst;
  }

  i32And(a: ValueInput, b: ValueInput): VarRef {
    const dst = this.#allocVar();

    this.#push({ op: "i32.and", dst, a: toValueRef(a), b: toValueRef(b) });
    return dst;
  }

  setFlags(producer: FlagProducerName, inputs: Readonly<Record<string, ValueInput>>): void {
    this.#push(
      createIrFlagSetOp(
        producer,
        Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, toValueRef(value)]))
      )
    );
  }

  materializeFlags(mask: FlagMask): void {
    this.#push({ op: "flags.materialize", mask });
  }

  boundaryFlags(mask: FlagMask): void {
    this.#push({ op: "flags.boundary", mask });
  }

  condition(cc: ConditionCode): VarRef {
    const dst = this.#allocVar();

    this.#push({ op: "aluFlags.condition", dst, cc });
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

  finish(): IrBlockTerminator {
    if (this.#terminator === undefined) {
      this.next();
    }

    if (this.#terminator === undefined) {
      throw new Error("IR block is missing a terminator");
    }

    return this.#terminator;
  }

  block(): IrBlock {
    this.finish();
    return [...this.#ops];
  }
}

export function irBlockTerminator(block: IrBlock): IrBlockTerminator {
  const terminator = block[block.length - 1];

  if (terminator === undefined || !isIrTerminatorOp(terminator)) {
    throw new Error("IR block is missing a terminator");
  }

  return terminator.op;
}
