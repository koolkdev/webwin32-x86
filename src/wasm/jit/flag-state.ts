import {
  conditionFlagReadMask,
  flagProducerEffect,
  SIR_ALU_FLAG_MASK
} from "../../arch/x86/sir/flag-analysis.js";
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

type JitFlagStateOptions = Readonly<{
  emitLoadAluFlags(): void;
  emitStoreAluFlags(emitValue: () => void): void;
}>;

export type JitFlagState = Readonly<{
  emitSet(producer: FlagProducerName, inputs: Readonly<Record<string, ValueRef>>, helpers: WasmSirEmitHelpers): void;
  emitMaterialize(mask: number): void;
  emitBoundary(mask: number): void;
  emitCondition(cc: ConditionCode): void;
  assertNoPending(): void;
}>;

export function createJitFlagState(
  body: WasmFunctionBodyEncoder,
  aluFlagsLocal: number,
  options: JitFlagStateOptions
): JitFlagState {
  const aluFlags = wasmSirLocalAluFlagsStorage(body, aluFlagsLocal);
  const inputLocals = new Map<string, number>();
  let pending: PendingFlags | undefined;
  let aluFlagsLocalValid = false;
  let aluFlagsLocalDirty = false;
  let materializedMask = 0;

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
      materializedMask = 0;
    },
    emitMaterialize: (mask) => {
      const missingMask = mask & ~materializedMask;

      if (missingMask === 0) {
        return;
      }

      if (pending === undefined) {
        ensureAluFlagsLoaded();
        materializedMask |= missingMask;
        return;
      }

      materializePending(missingMask);
    },
    emitBoundary: (mask) => {
      materializePending(mask & ~materializedMask);

      if (!aluFlagsLocalDirty) {
        return;
      }

      options.emitStoreAluFlags(() => {
        body.localGet(aluFlagsLocal);
      });
      aluFlagsLocalDirty = false;
    },
    emitCondition: (cc) => {
      assertMaterialized(conditionFlagReadMask(cc), `JIT condition ${cc}`);
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

  function materializePending(mask: number): void {
    if (pending === undefined) {
      return;
    }

    const pendingFlags = pending;
    const pendingMask = producerFlagMask(pendingFlags.producer);
    const materializeMask = mask & pendingMask & ~materializedMask;

    if (materializeMask === 0) {
      return;
    }

    emitPendingFlags(pendingFlags, materializeMask);
    materializedMask |= materializeMask;

    if ((materializedMask & pendingMask) === pendingMask) {
      pending = undefined;
    }
  }

  function assertNoPending(): void {
    if (pending !== undefined) {
      throw new Error("JIT pending flags must be materialized explicitly");
    }
  }

  function assertMaterialized(mask: number, context: string): void {
    if ((materializedMask & mask) !== mask) {
      throw new Error(`${context} must be preceded by flags.materialize`);
    }
  }

  function emitPendingFlags(pendingFlags: PendingFlags, mask: number): void {
    const inputRefs: Record<string, ValueRef> = {};
    const localsByVarId = new Map<number, number>();
    let nextVarId = 0;

    if (!producerWritesAllAluFlags(pendingFlags.producer)) {
      ensureAluFlagsLoaded();
    }

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

    emitSetFlags(
      body,
      aluFlags,
      pendingFlags.producer,
      inputRefs,
      {
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
      },
      { mask }
    );
    aluFlagsLocalValid = true;
    aluFlagsLocalDirty = true;
  }

  function ensureAluFlagsLoaded(): void {
    if (aluFlagsLocalValid) {
      return;
    }

    options.emitLoadAluFlags();
    aluFlagsLocalValid = true;
  }
}

function producerWritesAllAluFlags(producer: FlagProducerName): boolean {
  return producerFlagMask(producer) === SIR_ALU_FLAG_MASK;
}

function producerFlagMask(producer: FlagProducerName): number {
  const effect = flagProducerEffect(producer);

  return effect.writes | effect.undefines;
}

function requiredLocal(localsByVarId: ReadonlyMap<number, number>, id: number): number {
  const local = localsByVarId.get(id);

  if (local === undefined) {
    throw new Error(`missing pending flag local: ${id}`);
  }

  return local;
}
