import { wasmValueType } from "#backends/wasm/encoder/types.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import type { WasmIrCachedValueLocal, WasmIrValueCache } from "#backends/wasm/codegen/emit.js";
import type { IrStorageExpr, IrValueExpr } from "#backends/wasm/codegen/expressions.js";
import type { ValueWidth } from "#backends/wasm/codegen/value-width.js";
import type { ValueRef } from "#x86/ir/model/types.js";
import {
  jitValueReadsReg,
  jitValuesEqual,
  jitValueUsesSymbolicReg,
  type JitValue
} from "#backends/wasm/jit/ir/values.js";
import type { OperandWidth } from "#x86/isa/types.js";
import {
  shouldCacheValue,
  type JitExpressionValueCachePlan,
  type JitValueUseCount
} from "#backends/wasm/jit/codegen/plan/value-cache.js";
import { jitInstructionWrittenReg } from "#backends/wasm/jit/codegen/plan/operand-analysis.js";

export type { JitExpressionValueCachePlan, JitValueUseCount } from "#backends/wasm/jit/codegen/plan/value-cache.js";

export type JitCachedValueUse = Readonly<{
  valueWidth: ValueWidth;
  local?: number;
}>;

export type JitCachedValueLocal = WasmIrCachedValueLocal;

export type JitValueCacheRuntime = WasmIrValueCache & Readonly<{
  beginInstruction(index: number): void;
  notifyWrite(target: IrStorageExpr, accessWidth: OperandWidth): void;
  emitJitValueForUse(value: JitValue, emitter: () => ValueWidth): JitCachedValueUse;
  captureJitValueForReuse(value: JitValue, emitter: () => ValueWidth): JitCachedValueLocal | undefined;
  jitValueForExpression(value: IrValueExpr): JitValue | undefined;
  jitValueForValueRef(value: ValueRef): JitValue | undefined;
}>;

type CachedJitValue = {
  readonly value: JitValue;
  local?: number | undefined;
  valueWidth: ValueWidth | undefined;
  available: boolean;
  escaped: boolean;
};

export class JitValueLocalStore {
  readonly #body: WasmFunctionBodyEncoder;
  readonly #entries = new Map<string, CachedJitValue>();

  constructor(body: WasmFunctionBodyEncoder, useCounts: readonly JitValueUseCount[]) {
    this.#body = body;

    for (const useCount of useCounts) {
      if (shouldCacheValue(useCount.value, useCount.useCount)) {
        this.#entries.set(jitValueKey(useCount.value), {
          value: useCount.value,
          valueWidth: undefined,
          available: false,
          escaped: false
        });
      }
    }
  }

  emitForUse(value: JitValue, emitter: () => ValueWidth): ValueWidth {
    return this.emitForUseWithLocal(value, emitter).valueWidth;
  }

  emitForUseWithLocal(value: JitValue, emitter: () => ValueWidth): JitCachedValueUse {
    const entry = this.#entryFor(value);

    if (entry === undefined) {
      return { valueWidth: emitter() };
    }

    const local = this.#localForEntry(entry);

    if (entry.available) {
      this.#body.localGet(local);
      return { valueWidth: requiredValueWidth(entry), local };
    }

    const valueWidth = emitter();

    this.#body.localTee(local);
    entry.valueWidth = valueWidth;
    entry.available = true;
    return { valueWidth, local };
  }

  // Pre-fill a selected cache entry for consumers that need the value later,
  // without leaving it on the stack. Returns true only when this call emitted
  // the expression and stored it with local.set.
  captureForReuse(
    value: JitValue,
    emitter: () => ValueWidth
  ): JitCachedValueLocal | undefined {
    const entry = this.#entryFor(value);

    if (entry === undefined) {
      return undefined;
    }

    const local = this.#localForEntry(entry);
    entry.escaped = true;

    if (entry.available) {
      return {
        local,
        valueWidth: requiredValueWidth(entry),
        emitted: false
      };
    }

    const valueWidth = emitter();

    this.#body.localSet(local);
    entry.valueWidth = valueWidth;
    entry.available = true;
    return { local, valueWidth, emitted: true };
  }

  forgetWhere(predicate: (value: JitValue) => boolean): void {
    for (const entry of this.#entries.values()) {
      if (predicate(entry.value)) {
        entry.available = false;
        entry.valueWidth = undefined;

        if (entry.escaped) {
          entry.local = undefined;
          entry.escaped = false;
        }
      }
    }
  }

  #entryFor(value: JitValue): CachedJitValue | undefined {
    const entry = this.#entries.get(jitValueKey(value));

    return entry !== undefined && jitValuesEqual(entry.value, value) ? entry : undefined;
  }

  #localForEntry(entry: CachedJitValue): number {
    if (entry.local === undefined) {
      entry.local = this.#body.addLocal(wasmValueType.i32);
    }

    return entry.local;
  }
}

export function createJitValueCacheRuntime(
  body: WasmFunctionBodyEncoder,
  plan: JitExpressionValueCachePlan | undefined
): JitValueCacheRuntime | undefined {
  if (plan === undefined || plan.selectedUseCounts.length === 0) {
    return undefined;
  }

  const cachePlan = plan;
  const store = new JitValueLocalStore(body, cachePlan.selectedUseCounts);
  let currentEpoch = 0;
  let currentInstructionIndex = 0;

  return {
    beginInstruction: (index) => {
      if (index < 0 || index >= cachePlan.instructionPlans.length) {
        throw new Error(`JIT value cache instruction index out of range: ${index}`);
      }

      currentInstructionIndex = index;
    },
    emitForUse: (value, emitter) => {
      const jitValue = currentInstructionPlan().expressionValues.get(value);

      return jitValue !== undefined && valueIsSelected(cachePlan.selectedValuesByEpoch[currentEpoch] ?? [], jitValue)
        ? store.emitForUse(jitValue, emitter)
        : emitter();
    },
    emitJitValueForUse: (value, emitter) =>
      valueIsSelected(cachePlan.selectedValuesByEpoch[currentEpoch] ?? [], value)
        ? store.emitForUseWithLocal(value, emitter)
        : { valueWidth: emitter() },
    captureForReuse: (value, emitter) => {
      const jitValue = currentInstructionPlan().expressionValues.get(value);

      return jitValue !== undefined && valueIsSelected(cachePlan.selectedValuesByEpoch[currentEpoch] ?? [], jitValue)
        ? store.captureForReuse(jitValue, emitter)
        : undefined;
    },
    captureJitValueForReuse: (value, emitter) =>
      valueIsSelected(cachePlan.selectedValuesByEpoch[currentEpoch] ?? [], value)
        ? store.captureForReuse(value, emitter)
        : undefined,
    jitValueForExpression: (value) =>
      currentInstructionPlan().expressionValues.get(value) ?? jitValueForExpressionRef(value),
    jitValueForValueRef: (value) => {
      switch (value.kind) {
        case "const":
          return { kind: "const", type: value.type, value: value.value };
        case "var":
          return currentInstructionPlan().valueRefValues.get(value.id);
        case "nextEip":
          return undefined;
      }
    },
    notifyWrite: (target, accessWidth) => {
      const reg = jitInstructionWrittenReg(currentInstructionPlan(), target, accessWidth);

      if (reg === undefined) {
        return;
      }

      store.forgetWhere((value) =>
        jitValueReadsReg(value, reg) || jitValueUsesSymbolicReg(value, reg)
      );
      currentEpoch = Math.min(currentEpoch + 1, cachePlan.selectedValuesByEpoch.length - 1);
    }
  };

  function currentInstructionPlan() {
    const instructionPlan = cachePlan.instructionPlans[currentInstructionIndex];

    if (instructionPlan === undefined) {
      throw new Error(`missing JIT value cache instruction plan: ${currentInstructionIndex}`);
    }

    return instructionPlan;
  }

  function jitValueForExpressionRef(value: IrValueExpr): JitValue | undefined {
    switch (value.kind) {
      case "const":
        return { kind: "const", type: value.type, value: value.value };
      case "var":
        return currentInstructionPlan().valueRefValues.get(value.id);
      case "nextEip":
        return undefined;
      default:
        return undefined;
    }
  }
}

function requiredValueWidth(entry: CachedJitValue): ValueWidth {
  if (entry.valueWidth === undefined) {
    throw new Error("cached JIT value is available without width metadata");
  }

  return entry.valueWidth;
}

function jitValueKey(value: JitValue): string {
  switch (value.kind) {
    case "const":
      return `const:${value.type}:${value.value}`;
    case "reg":
      return `reg:${value.reg}`;
    case "value.binary":
      return `binary:${value.type}:${value.operator}:${jitValueKey(value.a)}:${jitValueKey(value.b)}`;
    case "value.unary":
      return `unary:${value.type}:${value.operator}:${jitValueKey(value.value)}`;
  }
}

function valueIsSelected(selected: readonly JitValueUseCount[], value: JitValue): boolean {
  return selected.some((entry) => jitValuesEqual(entry.value, value));
}
