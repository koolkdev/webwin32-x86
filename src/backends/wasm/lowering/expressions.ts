import {
  flagProducerConditionInputNames,
  requiredFlagProducerConditionInput,
  type IrFlagProducerConditionDescriptor
} from "#x86/ir/model/flag-conditions.js";
import type {
  ConditionCode,
  IrFlagSetOp,
  OperandRef,
  RegRef,
  IrOp,
  StorageRef,
  ValueRef,
  VarRef
} from "#x86/ir/model/types.js";

export type IrStorageExpr =
  | OperandRef
  | RegRef
  | Readonly<{ kind: "mem"; address: IrValueExpr }>;

export type IrValueExpr =
  | ValueRef
  | Readonly<{ kind: "src32"; source: IrStorageExpr }>
  | Readonly<{ kind: "address32"; operand: OperandRef }>
  | Readonly<{ kind: "aluFlags.condition"; cc: ConditionCode }>
  | Readonly<{
      kind: "flagProducer.condition";
      cc: ConditionCode;
      producer: IrFlagProducerConditionDescriptor["producer"];
      writtenMask: IrFlagProducerConditionDescriptor["writtenMask"];
      undefMask: IrFlagProducerConditionDescriptor["undefMask"];
      inputs: Readonly<Record<string, ValueRef>>;
    }>
  | Readonly<{ kind: "i32.add"; a: IrValueExpr; b: IrValueExpr }>
  | Readonly<{ kind: "i32.sub"; a: IrValueExpr; b: IrValueExpr }>
  | Readonly<{ kind: "i32.xor"; a: IrValueExpr; b: IrValueExpr }>
  | Readonly<{ kind: "i32.or"; a: IrValueExpr; b: IrValueExpr }>
  | Readonly<{ kind: "i32.and"; a: IrValueExpr; b: IrValueExpr }>;

export type IrExprOp =
  | Readonly<{ op: "let32"; dst: VarRef; value: IrValueExpr }>
  | Readonly<{ op: "set32"; target: IrStorageExpr; value: IrValueExpr }>
  | Readonly<{ op: "set32.if"; condition: IrValueExpr; target: IrStorageExpr; value: IrValueExpr }>
  | IrFlagSetOp
  | Readonly<{ op: "flags.materialize"; mask: number }>
  | Readonly<{ op: "flags.boundary"; mask: number }>
  | Readonly<{ op: "next" }>
  | Readonly<{ op: "jump"; target: IrValueExpr }>
  | Readonly<{ op: "conditionalJump"; condition: IrValueExpr; taken: IrValueExpr; notTaken: IrValueExpr }>
  | Readonly<{ op: "hostTrap"; vector: IrValueExpr }>;

export type IrExprBlock = readonly IrExprOp[];

export type IrExpressionFlagProducerConditionOp = IrFlagProducerConditionDescriptor & Readonly<{
  op: "flagProducer.condition";
  dst: VarRef;
}>;

export type IrExpressionInputOp = IrOp | IrExpressionFlagProducerConditionOp;
export type IrExpressionInputBlock = readonly IrExpressionInputOp[];

export type IrExpressionOptions = Readonly<{
  canInlineGet32?: (source: StorageRef) => boolean;
}>;

export function buildIrExpressionBlock(
  block: IrExpressionInputBlock,
  options: IrExpressionOptions = {}
): IrExprBlock {
  const builder = new ExpressionBuilder(block, options);

  return builder.build();
}

class ExpressionBuilder {
  readonly #bindings = new Map<number, IrValueExpr>();
  readonly #ops: IrExprOp[] = [];
  readonly #useCounts: ReadonlyMap<number, number>;
  readonly #conditionalWriteValueVars: ReadonlySet<number>;

  constructor(
    readonly block: IrExpressionInputBlock,
    readonly options: IrExpressionOptions
  ) {
    this.#useCounts = countVarUses(block);
    this.#conditionalWriteValueVars = conditionalWriteValueVars(block);
  }

  build(): IrExprBlock {
    for (const op of this.block) {
      switch (op.op) {
        case "get32":
          this.#defineValue(op.dst, { kind: "src32", source: this.#storageExpr(op.source) }, this.options.canInlineGet32?.(op.source) === true);
          break;
        case "set32":
          this.#ops.push({ op: "set32", target: this.#storageExpr(op.target), value: this.#valueExpr(op.value) });
          break;
        case "set32.if":
          this.#ops.push({
            op: "set32.if",
            condition: this.#valueExpr(op.condition),
            target: this.#storageExpr(op.target),
            value: this.#valueExpr(this.#materializedValue(op.value))
          });
          break;
        case "address32":
          this.#defineValue(op.dst, { kind: "address32", operand: op.operand }, true);
          break;
        case "const32":
          this.#bindings.set(op.dst.id, { kind: "const32", value: op.value });
          break;
        case "i32.add":
        case "i32.sub":
        case "i32.xor":
        case "i32.or":
        case "i32.and":
          this.#defineValue(op.dst, { kind: op.op, a: this.#valueExpr(op.a), b: this.#valueExpr(op.b) }, true);
          break;
        case "aluFlags.condition":
          this.#defineValue(op.dst, { kind: "aluFlags.condition", cc: op.cc }, false);
          break;
        case "flagProducer.condition":
          this.#defineValue(op.dst, {
            kind: "flagProducer.condition",
            cc: op.cc,
            producer: op.producer,
            writtenMask: op.writtenMask,
            undefMask: op.undefMask,
            inputs: this.#materializedFlagProducerConditionInputs(op)
          }, true);
          break;
        case "flags.set":
          this.#ops.push({
            op: "flags.set",
            producer: op.producer,
            writtenMask: op.writtenMask,
            undefMask: op.undefMask,
            inputs: Object.fromEntries(
              Object.entries(op.inputs).map(([name, value]) => [name, this.#materializedValue(value)])
            )
          });
          break;
        case "flags.materialize":
          this.#ops.push(op);
          break;
        case "flags.boundary":
          this.#ops.push(op);
          break;
        case "next":
          this.#ops.push(op);
          break;
        case "jump":
          this.#ops.push({ op: "jump", target: this.#valueExpr(op.target) });
          break;
        case "conditionalJump":
          this.#ops.push({
            op: "conditionalJump",
            condition: this.#valueExpr(op.condition),
            taken: this.#valueExpr(op.taken),
            notTaken: this.#valueExpr(op.notTaken)
          });
          break;
        case "hostTrap":
          this.#ops.push({ op: "hostTrap", vector: this.#valueExpr(op.vector) });
          break;
      }
    }

    return this.#ops;
  }

  #defineValue(dst: VarRef, value: IrValueExpr, inlineable: boolean): void {
    if (inlineable && remainingUses(this.#useCounts, dst.id) <= 1 && !this.#conditionalWriteValueVars.has(dst.id)) {
      this.#bindings.set(dst.id, value);
      return;
    }

    this.#ops.push({ op: "let32", dst, value });
  }

  #materializedValue(value: ValueRef): ValueRef {
    const expr = this.#valueExpr(value);

    if (expr.kind === "var" || expr.kind === "const32" || expr.kind === "nextEip") {
      return expr;
    }

    const materialized = value.kind === "var" ? value : undefined;

    if (materialized === undefined) {
      throw new Error("cannot materialize non-var IR expression input");
    }

    this.#ops.push({ op: "let32", dst: materialized, value: expr });
    this.#bindings.delete(materialized.id);
    return materialized;
  }

  #materializedFlagProducerConditionInputs(op: IrFlagProducerConditionDescriptor): Readonly<Record<string, ValueRef>> {
    return Object.fromEntries(
      flagProducerConditionInputNames(op).map((name) => [
        name,
        this.#materializedValue(requiredFlagProducerConditionInput(op, name))
      ])
    );
  }

  #storageExpr(storage: StorageRef): IrStorageExpr {
    switch (storage.kind) {
      case "operand":
      case "reg":
        return storage;
      case "mem":
        return { kind: "mem", address: this.#valueExpr(storage.address) };
    }
  }

  #valueExpr(value: ValueRef): IrValueExpr {
    if (value.kind !== "var") {
      return value;
    }

    const binding = this.#bindings.get(value.id);

    if (binding === undefined) {
      return value;
    }

    if (binding.kind !== "const32") {
      this.#bindings.delete(value.id);
    }

    return binding;
  }
}

function countVarUses(block: IrExpressionInputBlock): Map<number, number> {
  const counts = new Map<number, number>();

  for (const op of block) {
    switch (op.op) {
      case "get32":
        countStorageUses(counts, op.source);
        break;
      case "set32":
        countStorageUses(counts, op.target);
        countValueUse(counts, op.value);
        break;
      case "set32.if":
        countValueUse(counts, op.condition);
        countStorageUses(counts, op.target);
        countValueUse(counts, op.value);
        break;
      case "address32":
      case "const32":
      case "aluFlags.condition":
      case "next":
        break;
      case "flagProducer.condition":
        for (const name of flagProducerConditionInputNames(op)) {
          countValueUse(counts, requiredFlagProducerConditionInput(op, name));
        }
        break;
      case "i32.add":
      case "i32.sub":
      case "i32.xor":
      case "i32.or":
      case "i32.and":
        countValueUse(counts, op.a);
        countValueUse(counts, op.b);
        break;
      case "flags.set":
        for (const value of Object.values(op.inputs)) {
          countValueUse(counts, value);
        }
        break;
      case "flags.materialize":
      case "flags.boundary":
        break;
      case "jump":
        countValueUse(counts, op.target);
        break;
      case "conditionalJump":
        countValueUse(counts, op.condition);
        countValueUse(counts, op.taken);
        countValueUse(counts, op.notTaken);
        break;
      case "hostTrap":
        countValueUse(counts, op.vector);
        break;
    }
  }

  return counts;
}

function countStorageUses(counts: Map<number, number>, storage: StorageRef): void {
  if (storage.kind === "mem") {
    countValueUse(counts, storage.address);
  }
}

function countValueUse(counts: Map<number, number>, value: ValueRef): void {
  if (value.kind === "var") {
    counts.set(value.id, remainingUses(counts, value.id) + 1);
  }
}

function conditionalWriteValueVars(block: IrExpressionInputBlock): ReadonlySet<number> {
  const vars = new Set<number>();

  for (const op of block) {
    if (op.op === "set32.if" && op.value.kind === "var") {
      vars.add(op.value.id);
    }
  }

  return vars;
}

function remainingUses(useCounts: ReadonlyMap<number, number>, id: number): number {
  return useCounts.get(id) ?? 0;
}
