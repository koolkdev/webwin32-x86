import {
  buildIrExpressionBlock,
  type IrExpressionOptions,
  type IrExpressionInputBlock,
  type IrExprOp,
  type IrExprBlock,
  type IrSetExprOp,
  type IrStorageExpr,
  type IrValueExpr
} from "#backends/wasm/codegen/expressions.js";
import type {
  ConditionCode,
  IrFlagSetOp,
} from "#x86/ir/model/types.js";
import type { OperandWidth } from "#x86/isa/types.js";
import { i32 } from "#x86/state/cpu-state.js";
import type { WasmLocalScratchAllocator } from "#backends/wasm/encoder/local-scratch.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import { assignIrExprVarSlots, type IrExprVarSlotAssignment } from "./var-slots.js";
import {
  arithmeticResultValueWidth,
  bitwiseResultValueWidth,
  cleanValueWidth,
  constValueWidth,
  emitCleanValueForFullUse,
  emitMaskValueToWidth,
  maskedConstValue,
  untrackedValueWidth,
  type WasmIrEmitValueOptions,
  type ValueWidth
} from "./value-width.js";

export type WasmIrEmitContext = Readonly<{
  body: WasmFunctionBodyEncoder;
  scratch: WasmLocalScratchAllocator;
  expression?: IrExpressionOptions;
  emitGet(
    source: IrStorageExpr,
    accessWidth: OperandWidth,
    helpers: WasmIrEmitHelpers,
    options?: WasmIrEmitValueOptions
  ): ValueWidth;
  emitSet(
    target: IrStorageExpr,
    value: IrValueExpr,
    accessWidth: OperandWidth,
    helpers: WasmIrEmitHelpers,
    op: IrSetExprOp
  ): void;
  emitSetIf(
    condition: IrValueExpr,
    target: IrStorageExpr,
    value: IrValueExpr,
    accessWidth: OperandWidth,
    helpers: WasmIrEmitHelpers
  ): void;
  emitAddress(source: IrStorageExpr, helpers: WasmIrEmitHelpers): void;
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
  emitValue(value: IrValueExpr, options?: WasmIrEmitValueOptions): ValueWidth;
  emitMaskedValue(value: IrValueExpr, width: OperandWidth): ValueWidth;
}>;

export function emitIrToWasm(block: IrExpressionInputBlock, context: WasmIrEmitContext): void {
  emitIrExpressionBlockToWasm(buildIrExpressionBlock(block, context.expression), context);
}

function emitIrExpressionBlockToWasm(block: IrExprBlock, context: WasmIrEmitContext): void {
  new IrExprWasmEmitter(block, context).emit();
}

function allocateWasmLocalsForIrExprSlots(
  context: WasmIrEmitContext,
  slotCount: number
): number[] {
  return Array.from(
    { length: slotCount },
    () => context.scratch.allocLocal(wasmValueType.i32)
  );
}

class IrExprWasmEmitter {
  readonly #block: IrExprBlock;
  readonly #context: WasmIrEmitContext;
  readonly #slots: IrExprVarSlotAssignment;
  readonly #slotLocals: readonly number[];
  readonly #localValueWidths = new Map<number, ValueWidth>();
  readonly #helpers: WasmIrEmitHelpers = {
    emitValue: (value, options) => this.#emitValue(value, options),
    emitMaskedValue: (value, width) => this.#emitMaskedValue(value, width)
  };

  constructor(block: IrExprBlock, context: WasmIrEmitContext) {
    this.#block = block;
    this.#context = context;
    this.#slots = assignIrExprVarSlots(this.#block);
    this.#slotLocals = allocateWasmLocalsForIrExprSlots(this.#context, this.#slots.slotCount);
  }

  emit(): void {
    try {
      for (const op of this.#block) {
        this.#emitOp(op);
      }
    } finally {
      this.#freeSlotLocals();
    }
  }

  #emitOp(op: IrExprOp): void {
    switch (op.op) {
      case "let32":
        this.#localValueWidths.set(op.dst.id, this.#emitValue(op.value));
        this.#context.body.localSet(this.#wasmLocalForVar(op.dst.id));
        return;
      case "set":
        this.#context.emitSet(op.target, op.value, op.accessWidth, this.#helpers, op);
        return;
      case "set.if":
        this.#context.emitSetIf(op.condition, op.target, op.value, op.accessWidth, this.#helpers);
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

  #emitValue(value: IrValueExpr, options: WasmIrEmitValueOptions = {}): ValueWidth {
    const valueWidth = this.#emitValueUnmasked(value, options);

    if (options.requestedWidth === undefined) {
      return valueWidth;
    }

    return options.requestedWidth === 32
      ? emitCleanValueForFullUse(this.#context.body, valueWidth)
      : emitMaskValueToWidth(this.#context.body, options.requestedWidth, valueWidth);
  }

  #emitMaskedValue(value: IrValueExpr, width: OperandWidth): ValueWidth {
    if (value.kind === "const32") {
      const masked = maskedConstValue(value.value, width);

      this.#context.body.i32Const(masked);
      return constValueWidth(masked);
    }

    return emitMaskValueToWidth(this.#context.body, width, this.#emitValue(value));
  }

  #emitValueUnmasked(value: IrValueExpr, options: WasmIrEmitValueOptions): ValueWidth {
    switch (value.kind) {
      case "var":
        this.#context.body.localGet(this.#wasmLocalForVar(value.id));
        return this.#localValueWidths.get(value.id) ?? untrackedValueWidth();
      case "const32":
        this.#context.body.i32Const(i32(value.value));
        return constValueWidth(value.value);
      case "nextEip":
        this.#context.emitNextEip(this.#helpers);
        return untrackedValueWidth();
      case "source":
        return this.#context.emitGet(value.source, value.accessWidth, this.#helpers, options);
      case "address":
        this.#context.emitAddress(value.operand, this.#helpers);
        return untrackedValueWidth();
      case "aluFlags.condition":
        this.#context.emitAluFlagsCondition(value.cc);
        return cleanValueWidth(8);
      case "flagProducer.condition":
        this.#context.emitFlagProducerCondition(value, this.#helpers);
        return cleanValueWidth(8);
      case "i32.add":
        {
          const left = this.#emitValue(value.a, { requestedWidth: 32 });
          const right = this.#emitValue(value.b, { requestedWidth: 32 });

          this.#context.body.i32Add();
          return arithmeticResultValueWidth(left, right);
        }
      case "i32.sub":
        {
          const left = this.#emitValue(value.a, { requestedWidth: 32 });
          const right = this.#emitValue(value.b, { requestedWidth: 32 });

          this.#context.body.i32Sub();
          return arithmeticResultValueWidth(left, right);
        }
      case "i32.xor":
        {
          const left = this.#emitValue(value.a, { widthInsensitive: true });
          const right = this.#emitValue(value.b, { widthInsensitive: true });

          this.#context.body.i32Xor();
          return bitwiseResultValueWidth("i32.xor", left, right);
        }
      case "i32.or":
        {
          const left = this.#emitValue(value.a, { widthInsensitive: true });
          const right = this.#emitValue(value.b, { widthInsensitive: true });

          this.#context.body.i32Or();
          return bitwiseResultValueWidth("i32.or", left, right);
        }
      case "i32.and":
        {
          const left = this.#emitValue(value.a, { widthInsensitive: true });
          const right = this.#emitValue(value.b, { widthInsensitive: true });

          this.#context.body.i32And();
          return bitwiseResultValueWidth("i32.and", left, right);
        }
      case "i32.shr_u":
        this.#emitValue(value.a, { requestedWidth: 32 });
        this.#emitValue(value.b, { requestedWidth: 32 });
        this.#context.body.i32ShrU();
        return untrackedValueWidth();
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
