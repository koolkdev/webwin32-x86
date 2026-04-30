import { reg32, type Reg32 } from "../../arch/x86/instruction/types.js";
import { stateOffset } from "../abi.js";
import type { WasmFunctionBodyEncoder } from "../encoder/function-body.js";
import { wasmValueType } from "../encoder/types.js";
import type { WasmSirReg32Storage } from "../sir/registers.js";
import { emitLoadStateU32, emitStoreStateU32 } from "../sir/state.js";

export type JitReg32Storage = WasmSirReg32Storage & Readonly<{
  emitFlushDirty(): void;
}>;

export type JitSirState = Readonly<{
  regs: JitReg32Storage;
  eipLocal: number;
  eflagsLocal: number;
  instructionCountLocal: number;
  emitEntryLoads(): void;
  emitExitStores(): void;
}>;

export function createJitSirState(body: WasmFunctionBodyEncoder): JitSirState {
  const regs = createLazyJitReg32Storage(body);
  const eipLocal = body.addLocal(wasmValueType.i32);
  const eflagsLocal = body.addLocal(wasmValueType.i32);
  const instructionCountLocal = body.addLocal(wasmValueType.i32);

  return {
    regs,
    eipLocal,
    eflagsLocal,
    instructionCountLocal,
    emitEntryLoads: () => {
      emitLoadStateU32(body, stateOffset.eip);
      body.localSet(eipLocal);
      emitLoadStateU32(body, stateOffset.eflags);
      body.localSet(eflagsLocal);
      emitLoadStateU32(body, stateOffset.instructionCount);
      body.localSet(instructionCountLocal);
    },
    emitExitStores: () => {
      regs.emitFlushDirty();
      emitStoreStateU32(body, stateOffset.eip, () => {
        body.localGet(eipLocal);
      });
      emitStoreStateU32(body, stateOffset.eflags, () => {
        body.localGet(eflagsLocal);
      });
      emitStoreStateU32(body, stateOffset.instructionCount, () => {
        body.localGet(instructionCountLocal);
      });
    }
  };
}

function createLazyJitReg32Storage(body: WasmFunctionBodyEncoder): JitReg32Storage {
  const locals = new Map<Reg32, number>();
  const dirty = new Set<Reg32>();

  return {
    emitGet: (reg) => {
      body.localGet(localForReg(body, locals, reg, "load"));
    },
    emitSet: (reg, emitValue) => {
      const local = localForReg(body, locals, reg, "unused");

      emitValue();
      body.localSet(local);
      dirty.add(reg);
    },
    emitFlushDirty: () => {
      for (const reg of reg32) {
        if (!dirty.has(reg)) {
          continue;
        }

        const local = locals.get(reg);

        if (local === undefined) {
          throw new Error(`dirty JIT register has no local: ${reg}`);
        }

        emitStoreStateU32(body, stateOffset[reg], () => {
          body.localGet(local);
        });
      }
    }
  };
}

function localForReg(
  body: WasmFunctionBodyEncoder,
  locals: Map<Reg32, number>,
  reg: Reg32,
  mode: "load" | "unused"
): number {
  let local = locals.get(reg);

  if (local !== undefined) {
    return local;
  }

  local = body.addLocal(wasmValueType.i32);
  locals.set(reg, local);

  if (mode === "load") {
    emitLoadStateU32(body, stateOffset[reg]);
    body.localSet(local);
  }

  return local;
}
