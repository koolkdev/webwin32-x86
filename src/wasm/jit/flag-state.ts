import {
  conditionFlagReadMask,
  SIR_ALU_FLAG_MASK,
  SIR_ALU_FLAG_MASKS
} from "../../arch/x86/sir/flag-analysis.js";
import { FLAG_PRODUCERS } from "../../arch/x86/sir/flags.js";
import type { ConditionCode, SirFlagSetOp, ValueRef } from "../../arch/x86/sir/types.js";
import { i32 } from "../../core/state/cpu-state.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import { emitCondition } from "../sir/conditions.js";
import { wasmSirLocalAluFlagsStorage } from "../sir/alu-flags.js";
import { emitSetFlags } from "../sir/flags.js";
import type { WasmSirEmitHelpers } from "../sir/lower.js";

type PendingFlags = Readonly<{
  producer: SirFlagSetOp["producer"];
  writtenMask: SirFlagSetOp["writtenMask"];
  undefMask: SirFlagSetOp["undefMask"];
  inputs: ReadonlyMap<string, number>;
}>;

// Each compact aluFlags bit can come from a different place after partial writes:
// memory on entry, the cached local, or a still-lazy producer descriptor.
type FlagSource =
  | Readonly<{ kind: "incoming" }>
  | Readonly<{ kind: "local" }>
  | Readonly<{ kind: "pending"; pending: PendingFlags }>;

type JitFlagStateOptions = Readonly<{
  emitLoadAluFlags(): void;
  emitLoadAluFlagsValue(): void;
  emitStoreAluFlags(emitValue: () => void): void;
}>;

export type JitFlagState = Readonly<{
  emitSet(descriptor: SirFlagSetOp, helpers: WasmSirEmitHelpers): void;
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
  // Keyed by one-bit SIR_ALU_FLAG_MASKS values, not by x86 EFLAGS bit positions.
  const flagSources = new Map<number, FlagSource>(
    aluFlagMasks.map((mask) => [mask, incomingFlagSource])
  );
  let aluFlagsLocalDirty = false;
  let materializedMask = 0;

  return {
    emitSet: (descriptor, helpers) => {
      const pendingInputs = new Map<string, number>();

      for (const inputName of FLAG_PRODUCERS[descriptor.producer].inputs) {
        const input = descriptor.inputs[inputName];

        if (input === undefined) {
          throw new Error(`missing flag input '${inputName}' for ${descriptor.producer}`);
        }

        // A pending producer may outlive later flag producers. Allocate fresh
        // captured inputs so ADD.CF can survive a later INC, for example.
        const local = localForInput();

        helpers.emitValue(input);
        body.localSet(local);
        pendingInputs.set(inputName, local);
      }

      const pendingFlags = {
        producer: descriptor.producer,
        writtenMask: descriptor.writtenMask,
        undefMask: descriptor.undefMask,
        inputs: pendingInputs
      };
      const writtenMask = descriptor.writtenMask | descriptor.undefMask;

      setSource(writtenMask, { kind: "pending", pending: pendingFlags });
      materializedMask &= ~writtenMask;
    },
    emitMaterialize: (mask) => {
      const missingMask = mask & ~materializedMask;

      if (missingMask === 0) {
        return;
      }

      materializeFlags(missingMask);
    },
    emitBoundary: (mask) => {
      materializePendingFlags(mask & ~materializedMask);

      if (!aluFlagsLocalDirty) {
        return;
      }

      // If local producer bits will be stored, merge any untouched incoming bits
      // first so the store publishes a complete compact aluFlags word.
      materializeFlags(SIR_ALU_FLAG_MASK & ~materializedMask);
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

  function localForInput(): number {
    return body.addLocal(wasmValueType.i32);
  }

  function materializeFlags(mask: number): void {
    if (mask === 0) {
      return;
    }

    const incomingMask = sourceMask("incoming") & mask;

    if (incomingMask !== 0) {
      materializeIncoming(incomingMask);
    }

    materializePendingFlags(mask);
  }

  function materializePendingFlags(mask: number): void {
    for (const [pendingFlags, pendingMask] of pendingMasks(mask)) {
      emitPendingFlags(pendingFlags, pendingMask);
      setSource(pendingMask, localFlagSource);
      materializedMask |= pendingMask;
      aluFlagsLocalDirty = true;
    }
  }

  function materializeIncoming(mask: number): void {
    if (materializedMask === 0) {
      options.emitLoadAluFlags();
    } else {
      // Preserve already-materialized local bits while pulling only the requested
      // incoming bits from state. This is what lets INC publish new ZF/SF/etc.
      // without clobbering incoming CF.
      body.localGet(aluFlagsLocal);
      body.i32Const(i32(SIR_ALU_FLAG_MASK & ~mask)).i32And();
      options.emitLoadAluFlagsValue();
      body.i32Const(mask).i32And();
      body.i32Or();
      body.localSet(aluFlagsLocal);
    }

    setSource(mask, localFlagSource);
    materializedMask |= mask;
  }

  function assertNoPending(): void {
    if (sourceMask("pending") !== 0) {
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
      {
        op: "flags.set",
        producer: pendingFlags.producer,
        writtenMask: pendingFlags.writtenMask,
        undefMask: pendingFlags.undefMask,
        inputs: inputRefs
      },
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
  }

  function sourceMask(kind: FlagSource["kind"]): number {
    let mask = 0;

    for (const flagMask of aluFlagMasks) {
      if (requiredSource(flagMask).kind === kind) {
        mask |= flagMask;
      }
    }

    return mask;
  }

  function setSource(mask: number, source: FlagSource): void {
    for (const flagMask of aluFlagMasks) {
      if ((mask & flagMask) !== 0) {
        flagSources.set(flagMask, source);
      }
    }
  }

  function pendingMasks(mask: number): ReadonlyMap<PendingFlags, number> {
    const groups = new Map<PendingFlags, number>();

    for (const flagMask of aluFlagMasks) {
      if ((mask & flagMask) === 0) {
        continue;
      }

      const source = requiredSource(flagMask);

      if (source.kind !== "pending") {
        continue;
      }

      groups.set(source.pending, (groups.get(source.pending) ?? 0) | flagMask);
    }

    return groups;
  }

  function requiredSource(flagMask: number): FlagSource {
    const source = flagSources.get(flagMask);

    if (source === undefined) {
      throw new Error(`missing JIT flag source for mask: ${flagMask}`);
    }

    return source;
  }
}

function requiredLocal(localsByVarId: ReadonlyMap<number, number>, id: number): number {
  const local = localsByVarId.get(id);

  if (local === undefined) {
    throw new Error(`missing pending flag local: ${id}`);
  }

  return local;
}

const aluFlagMasks = Object.values(SIR_ALU_FLAG_MASKS);
const incomingFlagSource = { kind: "incoming" } as const satisfies FlagSource;
const localFlagSource = { kind: "local" } as const satisfies FlagSource;
