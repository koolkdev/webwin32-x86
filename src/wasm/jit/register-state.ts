import type { Reg32 } from "../../arch/x86/isa/types.js";
import { stateOffset } from "../abi.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import type { WasmSirReg32Storage } from "../sir/registers.js";
import { emitLoadStateU32, emitStoreStateU32 } from "../sir/state.js";

export type JitReg32State = WasmSirReg32Storage & Readonly<{
  assertNoPending(): void;
  commitPending(): void;
  dirtyRegs(): ReadonlySet<Reg32>;
  emitCommittedStore(reg: Reg32): void;
}>;

export function createJitReg32State(body: WasmFunctionBodyEncoder): JitReg32State {
  const committedLocals = new Map<Reg32, number>();
  const pendingLocals = new Map<Reg32, number>();
  const dirtyRegs = new Set<Reg32>();

  return {
    emitGet: (reg) => {
      body.localGet(pendingLocals.get(reg) ?? committedLocalForReg(body, committedLocals, reg));
    },
    emitSet: (reg, emitValue) => {
      const local = pendingLocalForReg(body, pendingLocals, reg);

      emitValue();
      body.localSet(local);
    },
    assertNoPending: () => {
      if (pendingLocals.size !== 0) {
        throw new Error("JIT register pending writes were not committed");
      }
    },
    commitPending: () => {
      for (const [reg, pendingLocal] of pendingLocals) {
        const committedLocal = committedLocals.get(reg);

        if (committedLocal === undefined) {
          committedLocals.set(reg, pendingLocal);
        } else {
          body.localGet(pendingLocal).localSet(committedLocal);
        }

        dirtyRegs.add(reg);
      }

      pendingLocals.clear();
    },
    dirtyRegs: () => new Set(dirtyRegs),
    emitCommittedStore: (reg) => {
      const local = committedLocals.get(reg);

      if (local === undefined) {
        throw new Error(`dirty JIT register has no committed local: ${reg}`);
      }

      emitStoreStateU32(body, stateOffset[reg], () => {
        body.localGet(local);
      });
    }
  };
}

function committedLocalForReg(
  body: WasmFunctionBodyEncoder,
  locals: Map<Reg32, number>,
  reg: Reg32
): number {
  let local = locals.get(reg);

  if (local !== undefined) {
    return local;
  }

  local = body.addLocal(wasmValueType.i32);
  locals.set(reg, local);
  emitLoadStateU32(body, stateOffset[reg]);
  body.localSet(local);
  return local;
}

function pendingLocalForReg(
  body: WasmFunctionBodyEncoder,
  pendingLocals: Map<Reg32, number>,
  reg: Reg32
): number {
  let local = pendingLocals.get(reg);

  if (local === undefined) {
    local = body.addLocal(wasmValueType.i32);
    pendingLocals.set(reg, local);
  }

  return local;
}
