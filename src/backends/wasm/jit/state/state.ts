import { reg32, type Reg32 } from "#x86/isa/types.js";
import { i32 } from "#x86/state/cpu-state.js";
import { stateOffset } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import { emitLoadStateU32, emitStoreStateU32 } from "#backends/wasm/lowering/state.js";
import { createJitFlagState, type JitFlagState } from "./flag-state.js";
import { createJitReg32State, type JitReg32State } from "./register-state.js";

export type JitExitTarget = {
  exitLocal: number;
  exitLabelDepth: number;
  emitBeforeExit?: () => void;
};

type ExitGenerationSnapshot = Readonly<{
  dirtyRegs: ReadonlySet<Reg32>;
}>;

export type JitIrState = Readonly<{
  regs: JitReg32State;
  flags: JitFlagState;
  eipLocal: number;
  aluFlagsLocal: number;
  instructionCountLocal: number;
  maxExitGeneration: number;
  emitLoadInstructionCount(): void;
  beginInstruction(exit: JitExitTarget, instructionEip: number): void;
  commitInstruction(): void;
  commitInstructionExit(emitEip: () => void): void;
  emitExitStoresForGeneration(generation: number): void;
}>;

export function createJitIrState(
  body: WasmFunctionBodyEncoder,
  maxExitGeneration: number
): JitIrState {
  const regs = createJitReg32State(body);
  const eipLocal = body.addLocal(wasmValueType.i32);
  const aluFlagsLocal = body.addLocal(wasmValueType.i32);
  const flags = createJitFlagState(body, aluFlagsLocal, {
    emitLoadAluFlags,
    emitLoadAluFlagsValue,
    emitStoreAluFlags
  });
  const instructionCountLocal = body.addLocal(wasmValueType.i32);
  const generationState = createExitGenerationState(maxExitGeneration);
  let activeExit: JitExitTarget | undefined;
  let committedInstructionDelta = 0;

  return {
    regs,
    flags,
    eipLocal,
    aluFlagsLocal,
    instructionCountLocal,
    maxExitGeneration,
    emitLoadInstructionCount: () => {
      emitLoadStateU32(body, stateOffset.instructionCount);
      body.localSet(instructionCountLocal);
    },
    beginInstruction: (exit, instructionEip) => {
      activeExit = exit;
      regs.assertNoPending();
      useExitGeneration(exit, generationState.currentGeneration);
      useExitStateStores(exit, () => {
        body.i32Const(i32(instructionEip));
      }, committedInstructionDelta);
    },
    commitInstruction,
    commitInstructionExit: (emitEip) => {
      const exit = requiredActiveExit();

      emitEip();
      body.localSet(eipLocal);
      regs.commitPending();
      useExitGeneration(exit, internCurrentRegisterGeneration());
      useExitStateStores(exit, () => {
        body.localGet(eipLocal);
      }, committedInstructionDelta + 1);
    },
    emitExitStoresForGeneration: (generation) => {
      const snapshot = generationState.snapshot(generation);

      if (snapshot === undefined) {
        return;
      }

      for (const reg of reg32) {
        if (!snapshot.dirtyRegs.has(reg)) {
          continue;
        }

        regs.emitCommittedStore(reg);
      }
    }
  };

  function commitInstruction(): void {
    regs.commitPending();
    committedInstructionDelta += 1;
    generationState.currentGeneration = internCurrentRegisterGeneration();
  }

  function internCurrentRegisterGeneration(): number {
    return generationState.intern({
      dirtyRegs: regs.dirtyRegs()
    });
  }

  function emitLoadAluFlags(): void {
    emitLoadAluFlagsValue();
    body.localSet(aluFlagsLocal);
  }

  function emitLoadAluFlagsValue(): void {
    emitLoadStateU32(body, stateOffset.aluFlags);
  }

  function emitStoreAluFlags(emitValue: () => void): void {
    emitStoreStateU32(body, stateOffset.aluFlags, emitValue);
  }

  function useExitStateStores(exit: JitExitTarget, emitEip: () => void, instructionDelta: number): void {
    exit.emitBeforeExit = () => {
      emitStoreStateU32(body, stateOffset.eip, emitEip);
      emitStoreStateU32(body, stateOffset.instructionCount, () => {
        body.localGet(instructionCountLocal);

        if (instructionDelta !== 0) {
          body.i32Const(instructionDelta).i32Add();
        }
      });
      flags.assertNoPending();
    };
  }

  function useExitGeneration(exit: JitExitTarget, generation: number): void {
    exit.exitLabelDepth = maxExitGeneration - generation;
  }

  function requiredActiveExit(): JitExitTarget {
    if (activeExit === undefined) {
      throw new Error("JIT instruction exit requested before beginInstruction");
    }

    return activeExit;
  }
}

function createExitGenerationState(maxExitGeneration: number): {
  currentGeneration: number;
  intern(snapshot: ExitGenerationSnapshot): number;
  snapshot(generation: number): ExitGenerationSnapshot | undefined;
} {
  const initialSnapshot: ExitGenerationSnapshot = {
    dirtyRegs: new Set()
  };
  const snapshots: ExitGenerationSnapshot[] = [initialSnapshot];
  const generationsByKey = new Map<string, number>([[generationKey(initialSnapshot), 0]]);

  return {
    currentGeneration: 0,
    intern: (snapshot) => {
      const key = generationKey(snapshot);
      const existing = generationsByKey.get(key);

      if (existing !== undefined) {
        return existing;
      }

      const generation = snapshots.length;

      if (generation > maxExitGeneration) {
        throw new Error(`too many JIT exit generations: ${generation} > ${maxExitGeneration}`);
      }

      snapshots.push({
        dirtyRegs: new Set(snapshot.dirtyRegs)
      });
      generationsByKey.set(key, generation);
      return generation;
    },
    snapshot: (generation) => snapshots[generation]
  };
}

function generationKey(snapshot: ExitGenerationSnapshot): string {
  const regs = reg32.filter((reg) => snapshot.dirtyRegs.has(reg)).join(",");

  return `regs=${regs}`;
}
