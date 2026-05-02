import {
  buildIrExpressionProgram,
  type IrExpressionOptions,
  type IrExprOp,
  type IrExprProgram,
  type IrStorageExpr,
  type IrValueExpr
} from "../../x86/ir/expressions.js";
import type {
  ConditionCode,
  IrFlagSetOp,
  IrProgram,
} from "../../x86/ir/types.js";
import { i32 } from "../../x86/state/cpu-state.js";
import type { WasmLocalScratchAllocator } from "../encoder/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import { assignIrExprVarSlots, type IrExprVarSlotAssignment } from "./var-slots.js";

export type WasmIrLoweringContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  expression?: IrExpressionOptions;
  emitGet32(source: IrStorageExpr, helpers: WasmIrEmitHelpers): void;
  emitSet32(target: IrStorageExpr, value: IrValueExpr, helpers: WasmIrEmitHelpers): void;
  emitAddress32(source: IrStorageExpr, helpers: WasmIrEmitHelpers): void;
  emitSetFlags(descriptor: IrFlagSetOp, helpers: WasmIrEmitHelpers): void;
  emitMaterializeFlags(mask: number, helpers: WasmIrEmitHelpers): void;
  emitBoundaryFlags(mask: number, helpers: WasmIrEmitHelpers): void;
  emitAluFlagsCondition(cc: ConditionCode): void;
  emitFlagProducerCondition(condition: Extract<IrValueExpr, { kind: "flagProducer.condition" }>, helpers: WasmIrEmitHelpers): void;
  emitNext(helpers: WasmIrEmitHelpers): void;
  emitNextEip(helpers: WasmIrEmitHelpers): void;
  emitJump(target: IrValueExpr, helpers: WasmIrEmitHelpers): void;
  emitConditionalJump(condition: IrValueExpr, taken: IrValueExpr, notTaken: IrValueExpr, helpers: WasmIrEmitHelpers): void;
  emitHostTrap(vector: IrValueExpr, helpers: WasmIrEmitHelpers): void;
}>;

export type WasmIrEmitHelpers = Readonly<{
  emitValue(value: IrValueExpr): void;
}>;

export function lowerIrToWasm(program: IrProgram, context: WasmIrLoweringContext): void {
  lowerIrExpressionProgramToWasm(buildIrExpressionProgram(program, context.expression), context);
}

function lowerIrExpressionProgramToWasm(program: IrExprProgram, context: WasmIrLoweringContext): void {
  new IrExprWasmLowerer(program, context).lower();
}

function allocateWasmLocalsForIrExprSlots(
  context: WasmIrLoweringContext,
  slotCount: number
): number[] {
  return Array.from(
    { length: slotCount },
    () => context.scratch.allocLocal(wasmValueType.i32)
  );
}

class IrExprWasmLowerer {
  readonly #program: IrExprProgram;
  readonly #context: WasmIrLoweringContext;
  readonly #slots: IrExprVarSlotAssignment;
  readonly #slotLocals: readonly number[];
  readonly #helpers: WasmIrEmitHelpers = {
    emitValue: (value) => this.#emitValue(value)
  };

  constructor(program: IrExprProgram, context: WasmIrLoweringContext) {
    this.#program = program;
    this.#context = context;
    this.#slots = assignIrExprVarSlots(this.#program);
    this.#slotLocals = allocateWasmLocalsForIrExprSlots(this.#context, this.#slots.slotCount);
  }

  lower(): void {
    try {
      for (const op of this.#program) {
        this.#lowerOp(op);
      }
    } finally {
      this.#freeSlotLocals();
    }
  }

  #lowerOp(op: IrExprOp): void {
    switch (op.op) {
      case "let32":
        this.#emitValue(op.value);
        this.#context.body.localSet(this.#wasmLocalForVar(op.dst.id));
        return;
      case "set32":
        this.#context.emitSet32(op.target, op.value, this.#helpers);
        return;
      case "flags.set":
        this.#context.emitSetFlags(op, this.#helpers);
        return;
      case "flags.materialize":
        this.#context.emitMaterializeFlags(op.mask, this.#helpers);
        return;
      case "flags.boundary":
        this.#context.emitBoundaryFlags(op.mask, this.#helpers);
        return;
      case "next":
        this.#context.emitNext(this.#helpers);
        return;
      case "jump":
        this.#context.emitJump(op.target, this.#helpers);
        return;
      case "conditionalJump":
        this.#context.emitConditionalJump(op.condition, op.taken, op.notTaken, this.#helpers);
        return;
      case "hostTrap":
        this.#context.emitHostTrap(op.vector, this.#helpers);
        return;
    }
  }

  #emitValue(value: IrValueExpr): void {
    switch (value.kind) {
      case "var":
        this.#context.body.localGet(this.#wasmLocalForVar(value.id));
        return;
      case "const32":
        this.#context.body.i32Const(i32(value.value));
        return;
      case "nextEip":
        this.#context.emitNextEip(this.#helpers);
        return;
      case "src32":
        this.#context.emitGet32(value.source, this.#helpers);
        return;
      case "address32":
        this.#context.emitAddress32(value.operand, this.#helpers);
        return;
      case "aluFlags.condition":
        this.#context.emitAluFlagsCondition(value.cc);
        return;
      case "flagProducer.condition":
        this.#context.emitFlagProducerCondition(value, this.#helpers);
        return;
      case "i32.add":
        this.#emitValue(value.a);
        this.#emitValue(value.b);
        this.#context.body.i32Add();
        return;
      case "i32.sub":
        this.#emitValue(value.a);
        this.#emitValue(value.b);
        this.#context.body.i32Sub();
        return;
      case "i32.xor":
        this.#emitValue(value.a);
        this.#emitValue(value.b);
        this.#context.body.i32Xor();
        return;
      case "i32.or":
        this.#emitValue(value.a);
        this.#emitValue(value.b);
        this.#context.body.i32Or();
        return;
      case "i32.and":
        this.#emitValue(value.a);
        this.#emitValue(value.b);
        this.#context.body.i32And();
        return;
    }
  }

  #freeSlotLocals(): void {
    for (let index = this.#slotLocals.length - 1; index >= 0; index -= 1) {
      this.#context.scratch.freeLocal(this.#slotLocals[index]!);
    }
  }

  #wasmLocalForVar(id: number): number {
    const slot = this.#slots.slotByVar.get(id);

    if (slot === undefined) {
      throw new Error(`missing IR expression slot for var: ${id}`);
    }

    const local = this.#slotLocals[slot];

    if (local === undefined) {
      throw new Error(`missing Wasm local for IR expression slot: ${slot}`);
    }

    return local;
  }
}
