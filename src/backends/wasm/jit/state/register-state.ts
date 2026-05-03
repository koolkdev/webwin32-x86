import type { Reg32 } from "#x86/isa/types.js";
import { stateOffset } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import type { WasmIrReg32Storage } from "#backends/wasm/lowering/registers.js";
import { emitLoadStateU32, emitStoreStateU32 } from "#backends/wasm/lowering/state.js";

export type JitReg32InstructionOptions = Readonly<{
  preserveCommittedRegs: boolean;
}>;

export type JitReg32State = WasmIrReg32Storage & Readonly<{
  beginInstruction(options: JitReg32InstructionOptions): void;
  commitPending(): void;
  emitCommittedStore(reg: Reg32): void;
}>;

export function createJitReg32State(body: WasmFunctionBodyEncoder): JitReg32State {
  const committedLocals = new Map<Reg32, number>();
  const pendingLocals = new Map<Reg32, number>();
  let preserveCommittedRegs = false;

  return {
    beginInstruction: (options) => {
      assertNoPending();
      preserveCommittedRegs = options.preserveCommittedRegs;
    },
    emitGet: (reg) => {
      body.localGet(pendingLocals.get(reg) ?? committedLocalForReg(body, committedLocals, reg));
    },
    emitSet: (reg, emitValue) => {
      emitValue();
      const local = preserveCommittedRegs
        ? pendingLocalForReg(body, pendingLocals, reg)
        : committedLocalForRegWrite(body, committedLocals, reg);

      body.localSet(local);
    },
    commitPending: () => {
      for (const [reg, pendingLocal] of pendingLocals) {
        const committedLocal = committedLocals.get(reg);

        if (committedLocal === undefined) {
          committedLocals.set(reg, pendingLocal);
        } else {
          body.localGet(pendingLocal).localSet(committedLocal);
        }

      }

      pendingLocals.clear();
      preserveCommittedRegs = false;
    },
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

  function assertNoPending(): void {
    if (pendingLocals.size !== 0) {
      throw new Error("JIT register pending writes were not committed");
    }
  }
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

function committedLocalForRegWrite(
  body: WasmFunctionBodyEncoder,
  locals: Map<Reg32, number>,
  reg: Reg32
): number {
  let local = locals.get(reg);

  if (local === undefined) {
    local = body.addLocal(wasmValueType.i32);
    locals.set(reg, local);
  }

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
