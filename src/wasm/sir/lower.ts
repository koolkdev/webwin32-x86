import {
  buildSirExpressionProgram,
  type SirExpressionOptions,
  type SirExprOp,
  type SirExprProgram,
  type SirStorageExpr,
  type SirValueExpr
} from "../../arch/x86/sir/expressions.js";
import type {
  ConditionCode,
  SirProgram,
  ValueRef
} from "../../arch/x86/sir/types.js";
import type { FlagProducerName } from "../../arch/x86/sir/types.js";
import { i32 } from "../../core/state/cpu-state.js";
import type { WasmLocalScratchAllocator } from "../encoder/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import { assignSirExprVarSlots, type SirExprVarSlotAssignment } from "./var-slots.js";

export type WasmSirLoweringContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  expression?: SirExpressionOptions;
  emitGet32(source: SirStorageExpr, helpers: WasmSirEmitHelpers): void;
  emitSet32(target: SirStorageExpr, value: SirValueExpr, helpers: WasmSirEmitHelpers): void;
  emitAddress32(source: SirStorageExpr, helpers: WasmSirEmitHelpers): void;
  emitSetFlags(producer: FlagProducerName, inputs: Readonly<Record<string, ValueRef>>, helpers: WasmSirEmitHelpers): void;
  emitMaterializeFlags(mask: number, helpers: WasmSirEmitHelpers): void;
  emitCondition(cc: ConditionCode): void;
  emitNext(helpers: WasmSirEmitHelpers): void;
  emitNextEip(helpers: WasmSirEmitHelpers): void;
  emitJump(target: SirValueExpr, helpers: WasmSirEmitHelpers): void;
  emitConditionalJump(condition: SirValueExpr, taken: SirValueExpr, notTaken: SirValueExpr, helpers: WasmSirEmitHelpers): void;
  emitHostTrap(vector: SirValueExpr, helpers: WasmSirEmitHelpers): void;
}>;

export type WasmSirEmitHelpers = Readonly<{
  emitValue(value: SirValueExpr): void;
}>;

export function lowerSirToWasm(program: SirProgram, context: WasmSirLoweringContext): void {
  lowerSirExpressionProgramToWasm(buildSirExpressionProgram(program, context.expression), context);
}

function lowerSirExpressionProgramToWasm(program: SirExprProgram, context: WasmSirLoweringContext): void {
  new SirExprWasmLowerer(program, context).lower();
}

function allocateWasmLocalsForSirExprSlots(
  context: WasmSirLoweringContext,
  slotCount: number
): number[] {
  return Array.from(
    { length: slotCount },
    () => context.scratch.allocLocal(wasmValueType.i32)
  );
}

class SirExprWasmLowerer {
  readonly #program: SirExprProgram;
  readonly #context: WasmSirLoweringContext;
  readonly #slots: SirExprVarSlotAssignment;
  readonly #slotLocals: readonly number[];
  readonly #helpers: WasmSirEmitHelpers = {
    emitValue: (value) => this.#emitValue(value)
  };

  constructor(program: SirExprProgram, context: WasmSirLoweringContext) {
    this.#program = program;
    this.#context = context;
    this.#slots = assignSirExprVarSlots(this.#program);
    this.#slotLocals = allocateWasmLocalsForSirExprSlots(this.#context, this.#slots.slotCount);
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

  #lowerOp(op: SirExprOp): void {
    switch (op.op) {
      case "let32":
        this.#emitValue(op.value);
        this.#context.body.localSet(this.#wasmLocalForVar(op.dst.id));
        return;
      case "set32":
        this.#context.emitSet32(op.target, op.value, this.#helpers);
        return;
      case "flags.set":
        this.#context.emitSetFlags(op.producer, op.inputs, this.#helpers);
        return;
      case "flags.materialize":
        this.#context.emitMaterializeFlags(op.mask, this.#helpers);
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

  #emitValue(value: SirValueExpr): void {
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
      case "condition":
        this.#context.emitCondition(value.cc);
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
      throw new Error(`missing SIR expression slot for var: ${id}`);
    }

    const local = this.#slotLocals[slot];

    if (local === undefined) {
      throw new Error(`missing Wasm local for SIR expression slot: ${slot}`);
    }

    return local;
  }
}
