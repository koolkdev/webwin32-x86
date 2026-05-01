import { FLAG_PRODUCERS } from "../../arch/x86/sir/flags.js";
import type { ConditionCode, FlagProducerName, ValueRef } from "../../arch/x86/sir/types.js";
import { i32 } from "../../core/state/cpu-state.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import { emitCondition } from "../sir/conditions.js";
import { wasmSirLocalAluFlagsStorage } from "../sir/alu-flags.js";
import { emitSetFlags } from "../sir/flags.js";
import type { WasmSirEmitHelpers } from "../sir/lower.js";

type PendingFlags = Readonly<{
  producer: FlagProducerName;
  inputs: ReadonlyMap<string, number>;
}>;

export type JitFlagState = Readonly<{
  emitSet(producer: FlagProducerName, inputs: Readonly<Record<string, ValueRef>>, helpers: WasmSirEmitHelpers): void;
  emitMaterialize(mask: number): void;
  emitCondition(cc: ConditionCode): void;
  assertNoPending(): void;
}>;

export function createJitFlagState(
  body: WasmFunctionBodyEncoder,
  aluFlagsLocal: number
): JitFlagState {
  const aluFlags = wasmSirLocalAluFlagsStorage(body, aluFlagsLocal);
  const inputLocals = new Map<string, number>();
  let pending: PendingFlags | undefined;

  return {
    emitSet: (producer, inputs, helpers) => {
      const pendingInputs = new Map<string, number>();

      for (const inputName of FLAG_PRODUCERS[producer].inputs) {
        const input = inputs[inputName];

        if (input === undefined) {
          throw new Error(`missing flag input '${inputName}' for ${producer}`);
        }

        const local = localForInput(inputName);

        helpers.emitValue(input);
        body.localSet(local);
        pendingInputs.set(inputName, local);
      }

      pending = { producer, inputs: pendingInputs };
    },
    emitMaterialize: (mask) => {
      if (mask !== 0) {
        materializePending();
      }
    },
    emitCondition: (cc) => {
      assertNoPending();
      emitCondition(body, aluFlags, cc);
    },
    assertNoPending
  };

  function localForInput(name: string): number {
    let local = inputLocals.get(name);

    if (local === undefined) {
      local = body.addLocal(wasmValueType.i32);
      inputLocals.set(name, local);
    }

    return local;
  }

  function materializePending(): void {
    if (pending === undefined) {
      return;
    }

    const pendingFlags = pending;

    pending = undefined;
    emitPendingFlags(pendingFlags);
  }

  function assertNoPending(): void {
    if (pending !== undefined) {
      throw new Error("JIT pending flags must be materialized explicitly");
    }
  }

  function emitPendingFlags(pendingFlags: PendingFlags): void {
    const inputRefs: Record<string, ValueRef> = {};
    const localsByVarId = new Map<number, number>();
    let nextVarId = 0;

    for (const inputName of FLAG_PRODUCERS[pendingFlags.producer].inputs) {
      const local = pendingFlags.inputs.get(inputName);

      if (local === undefined) {
        throw new Error(`missing pending flag input '${inputName}' for ${pendingFlags.producer}`);
      }

      const id = nextVarId;

      nextVarId += 1;
      inputRefs[inputName] = { kind: "var", id };
      localsByVarId.set(id, local);
    }

    emitSetFlags(body, aluFlags, pendingFlags.producer, inputRefs, {
      emitValue: (value) => {
        switch (value.kind) {
          case "var":
            body.localGet(requiredLocal(localsByVarId, value.id));
            return;
          case "const32":
            body.i32Const(i32(value.value));
            return;
          case "nextEip":
            throw new Error("nextEip is not a valid pending flag input");
        }
      }
    });
  }
}

function requiredLocal(localsByVarId: ReadonlyMap<number, number>, id: number): number {
  const local = localsByVarId.get(id);

  if (local === undefined) {
    throw new Error(`missing pending flag local: ${id}`);
  }

  return local;
}
