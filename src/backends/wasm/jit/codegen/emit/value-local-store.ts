import { wasmValueType } from "#backends/wasm/encoder/types.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import type { WasmIrValueCache } from "#backends/wasm/codegen/emit.js";
import type { IrStorageExpr } from "#backends/wasm/codegen/expressions.js";
import type { ValueWidth } from "#backends/wasm/codegen/value-width.js";
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

export type JitValueCacheRuntime = WasmIrValueCache & Readonly<{
  notifyWrite(target: IrStorageExpr, accessWidth: OperandWidth): void;
}>;

type CachedJitValue = {
  readonly value: JitValue;
  local?: number;
  valueWidth: ValueWidth | undefined;
  available: boolean;
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
          available: false
        });
      }
    }
  }

  emitForUse(value: JitValue, emitter: () => ValueWidth): ValueWidth {
    const entry = this.#entryFor(value);

    if (entry === undefined) {
      return emitter();
    }

    const local = this.#localForEntry(entry);

    if (entry.available) {
      this.#body.localGet(local);
      return requiredValueWidth(entry);
    }

    const valueWidth = emitter();

    this.#body.localTee(local);
    entry.valueWidth = valueWidth;
    entry.available = true;
    return valueWidth;
  }

  // Pre-fill a selected cache entry for consumers that need the value later,
  // without leaving it on the stack. Returns true only when this call emitted
  // the expression and stored it with local.set.
  maybeMaterializeForLater(value: JitValue, emitter: () => ValueWidth): boolean {
    const entry = this.#entryFor(value);

    if (entry === undefined || entry.available) {
      return false;
    }

    const valueWidth = emitter();

    this.#body.localSet(this.#localForEntry(entry));
    entry.valueWidth = valueWidth;
    entry.available = true;
    return true;
  }

  forgetWhere(predicate: (value: JitValue) => boolean): void {
    for (const entry of this.#entries.values()) {
      if (predicate(entry.value)) {
        entry.available = false;
        entry.valueWidth = undefined;
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

  const store = new JitValueLocalStore(body, plan.selectedUseCounts);
  let currentEpoch = 0;

  return {
    emitForUse: (value, emitter) => {
      const jitValue = plan.expressionValues.get(value);

      return jitValue !== undefined && valueIsSelected(plan.selectedValuesByEpoch[currentEpoch] ?? [], jitValue)
        ? store.emitForUse(jitValue, emitter)
        : emitter();
    },
    maybeMaterializeForLater: (value, emitter) => {
      const jitValue = plan.expressionValues.get(value);

      return jitValue !== undefined && valueIsSelected(plan.selectedValuesByEpoch[currentEpoch] ?? [], jitValue)
        ? store.maybeMaterializeForLater(jitValue, emitter)
        : false;
    },
    notifyWrite: (target, accessWidth) => {
      const reg = jitInstructionWrittenReg(plan, target, accessWidth);

      if (reg === undefined) {
        return;
      }

      store.forgetWhere((value) =>
        jitValueReadsReg(value, reg) || jitValueUsesSymbolicReg(value, reg)
      );
      currentEpoch = Math.min(currentEpoch + 1, plan.selectedValuesByEpoch.length - 1);
    }
  };
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
