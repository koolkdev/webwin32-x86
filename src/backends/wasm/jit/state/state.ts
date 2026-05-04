import { i32 } from "#x86/state/cpu-state.js";
import { stateOffset } from "#backends/wasm/abi.js";
import type { WasmFunctionBodyEncoder } from "#backends/wasm/encoder/function-body.js";
import { wasmValueType } from "#backends/wasm/encoder/types.js";
import { emitLoadStateU32, emitStoreStateU32 } from "#backends/wasm/lowering/state.js";
import type { JitExitPoint, JitExitState, JitStateSnapshot } from "#backends/wasm/jit/lowering-plan/types.js";
import { createJitFlagState, type JitFlagState } from "./flag-state.js";
import {
  createJitReg32State,
  type JitReg32InstructionOptions,
  type JitReg32State
} from "./register-state.js";

export type JitExitTarget = {
  exitLocal: number;
  exitLabelDepth: number;
  emitBeforeExit?: () => void;
};

type ExitStateStoreOptions = Readonly<{
  allowPendingFlags?: boolean;
}>;

export type JitIrState = Readonly<{
  regs: JitReg32State;
  flags: JitFlagState;
  eipLocal: number;
  aluFlagsLocal: number;
  instructionCountLocal: number;
  maxExitStateIndex: number;
  emitLoadInstructionCount(): void;
  beginInstruction(exit: JitExitTarget, snapshot: JitStateSnapshot, options: JitReg32InstructionOptions): void;
  prepareExitPoint(exitPoint: JitExitPoint, emitEip: () => void): void;
  finishPreInstructionExitPoints(): void;
  commitInstruction(): void;
  commitInstructionExit(exitPoint: JitExitPoint, emitEip: () => void): void;
  emitExitStateStores(index: number): void;
}>;

export function createJitIrState(
  body: WasmFunctionBodyEncoder,
  exitStates: readonly JitExitState[]
): JitIrState {
  const regs = createJitReg32State(body);
  const maxExitStateIndex = exitStates.length - 1;
  const eipLocal = body.addLocal(wasmValueType.i32);
  const aluFlagsLocal = body.addLocal(wasmValueType.i32);
  const flags = createJitFlagState(body, aluFlagsLocal, {
    emitLoadAluFlags,
    emitLoadAluFlagsValue,
    emitStoreAluFlags
  });
  const instructionCountLocal = body.addLocal(wasmValueType.i32);
  let activeExit: JitExitTarget | undefined;

  return {
    regs,
    flags,
    eipLocal,
    aluFlagsLocal,
    instructionCountLocal,
    maxExitStateIndex,
    emitLoadInstructionCount: () => {
      emitLoadStateU32(body, stateOffset.instructionCount);
      body.localSet(instructionCountLocal);
    },
    beginInstruction: (exit, snapshot, options) => {
      activeExit = exit;
      regs.beginInstruction(options);
      useExitState(exit, 0);
      useExitStateStores(exit, () => {
        body.i32Const(i32(snapshot.eip));
      }, snapshot.instructionCountDelta);
    },
    prepareExitPoint: (exitPoint, emitEip) => {
      const exit = requiredActiveExit();

      useExitState(exit, exitPoint.exitStateIndex);
      useExitStateStores(exit, emitEip, exitPoint.snapshot.instructionCountDelta, {
        allowPendingFlags: exitPoint.snapshot.kind === "preInstruction"
      });
    },
    finishPreInstructionExitPoints: () => {
      regs.commitPending();
    },
    commitInstruction,
    commitInstructionExit: (exitPoint, emitEip) => {
      const exit = requiredActiveExit();

      emitEip();
      body.localSet(eipLocal);
      regs.commitPending();
      useExitState(exit, exitPoint.exitStateIndex);
      useExitStateStores(exit, () => {
        body.localGet(eipLocal);
      }, exitPoint.snapshot.instructionCountDelta);
    },
    emitExitStateStores: (index) => {
      const snapshot = exitStates[index];

      if (snapshot === undefined) {
        return;
      }

      for (const reg of snapshot.regs) {
        regs.emitCommittedStore(reg);
      }
    }
  };

  function commitInstruction(): void {
    regs.commitPending();
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

  function useExitStateStores(
    exit: JitExitTarget,
    emitEip: () => void,
    instructionDelta: number,
    options: ExitStateStoreOptions = {}
  ): void {
    exit.emitBeforeExit = () => {
      emitStoreStateU32(body, stateOffset.eip, emitEip);
      emitStoreStateU32(body, stateOffset.instructionCount, () => {
        body.localGet(instructionCountLocal);

        if (instructionDelta !== 0) {
          body.i32Const(instructionDelta).i32Add();
        }
      });

      if (options.allowPendingFlags !== true) {
        flags.assertNoPending();
      }
    };
  }

  function useExitState(exit: JitExitTarget, index: number): void {
    exit.exitLabelDepth = maxExitStateIndex - index;
  }

  function requiredActiveExit(): JitExitTarget {
    if (activeExit === undefined) {
      throw new Error("JIT instruction exit requested before beginInstruction");
    }

    return activeExit;
  }
}
